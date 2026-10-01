import os
import tempfile
import unittest
from datetime import date, timedelta

from autopilot import store as st
from autopilot.models import LEAK_NO_CONV, Stats, UnitState
from autopilot.naver_client import ApiError, RateLimited
from autopilot.notify import Notifier
from autopilot.runner import run_site
from autopilot.store import Store
from tests.helpers import NOW, FakeClient, make_unit, site

GOOD = Stats(3000, 100, 20_000, 5, 100_000)


def build(n_leak=1, n_good=3, **site_kw):
    units, lookback = [], {}
    for i in range(n_leak):
        units.append(make_unit(f"l{i}"))
        lookback[f"l{i}"] = Stats(3600, 120, 30_000 - i * 1_000, 0, 0)
    for i in range(n_good):
        units.append(make_unit(f"h{i}"))
        lookback[f"h{i}"] = GOOD
    return FakeClient(units, lookback=lookback, today_date=NOW.date()), site(**site_kw)


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        self.messages = []
        self.notifier = Notifier(out=lambda *_: None)

    def run_(self, client, s, now=NOW, **kw):
        return run_site(s, client, self.store, self.notifier, now, **kw)

    def offs(self, client):
        return [w for w in client.writes if w[0] == "on" and w[2] is False]

    def test_dry_run_plans_but_never_writes(self):  # TC-13
        client, s = build()
        result = self.run_(client, s, dry_run=True)
        self.assertEqual(client.writes, [])
        self.assertGreaterEqual(result.planned, 1)
        rows = self.store.actions_since("t", NOW - timedelta(days=1))
        self.assertTrue(rows and all(r["status"] == st.DRY_RUN for r in rows))
        self.assertEqual(self.store.load_states("t"), {})

    def test_live_run_applies_and_remembers(self):  # TC-01
        client, s = build()
        result = self.run_(client, s, dry_run=False)
        self.assertIn(("on", "l0", False), client.writes)
        self.assertGreaterEqual(result.applied, 1)
        state = self.store.load_states("t")["l0"]
        self.assertEqual((state.bot_off_reason, state.off_count, state.last_change_at), (LEAK_NO_CONV, 1, NOW))
        row = [r for r in self.store.actions_since("t", NOW) if r["unit_id"] == "l0"][0]
        self.assertEqual((row["kind"], row["code"], row["status"]), ("off", LEAK_NO_CONV, st.APPLIED))

    def test_kill_switch_stops_everything(self):  # TC-11
        client, s = build()
        with tempfile.TemporaryDirectory() as tmp:
            kill = os.path.join(tmp, "KILL")
            open(kill, "w").close()
            result = self.run_(client, s, dry_run=False, kill_switch_file=kill)
        self.assertEqual(result.aborted, "KILL_SWITCH")
        self.assertEqual((client.writes, client.list_calls), ([], 0))

    def test_failed_data_collection_aborts_without_writes(self):
        client, s = build()
        client.fail_stats = ApiError(500, "boom", "/stats")
        result = self.run_(client, s, dry_run=False)
        self.assertEqual((result.aborted, client.writes), ("COLLECT_FAILED", []))
        self.assertTrue(any(level == "critical" for level, *_ in self.notifier.sent))

    def test_rate_limit_during_writes_stops_the_run(self):  # TC-10
        client, s = build(n_leak=3)
        client.fail_write = RateLimited(429, "slow", "/ncc/adgroups/x")
        result = self.run_(client, s, dry_run=False)
        self.assertEqual((result.aborted, result.failed, client.writes), ("RATE_LIMITED", 1, []))

    def test_action_flood_executes_nothing(self):
        client, s = build(n_leak=3, max_actions_per_run=1)
        result = self.run_(client, s, dry_run=False)
        self.assertEqual((result.aborted, client.writes), ("ACTION_FLOOD", []))

    def test_human_re_enabling_clears_the_bot_claim(self):
        client, s = build(n_leak=0, n_good=2)
        self.store.save_state("t", "h0", UnitState(bot_off_reason=LEAK_NO_CONV, bot_off_at=NOW, off_count=1))
        self.run_(client, s, dry_run=True)
        self.assertIsNone(self.store.load_states("t")["h0"].bot_off_reason)

    def test_bid_is_judged_on_data_since_the_last_change(self):
        client, s = build(n_leak=0, n_good=3)
        self.store.save_state("t", "h0", UnitState(last_change_at=NOW - timedelta(days=2, hours=1)))
        later = NOW + timedelta(days=1)  # last change was 3 days ago on Mar 8; recent window starts Mar 9
        client.today_date = later.date()
        self.run_(client, s, now=later, dry_run=True)
        since_dates = {since for since, _, ids in client.stat_calls if "h0" in ids}
        self.assertIn(date(2026, 3, 9), since_dates)
        self.assertIn(later.date() - timedelta(days=s.lookback_days), since_dates)


class ApprovalFlowTests(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        self.notifier = Notifier(out=lambda *_: None)

    def go(self, client, s, now):
        client.today_date = now.date()  # the fake API must report "today" for the simulated clock
        return run_site(s, client, self.store, self.notifier, now, dry_run=False)

    def test_big_off_batches_wait_for_a_human(self):  # TC-09
        client, s = build(n_leak=5, n_good=5)
        r1 = self.go(client, s, NOW)
        offs = [w[1] for w in client.writes if w[0] == "on" and w[2] is False]
        self.assertEqual(sorted(offs), ["l0", "l1", "l2"])
        pending = self.store.list_pending("t")
        self.assertEqual([p["unit_id"] for p in pending], ["l3", "l4"])
        self.assertEqual(r1.pending, 2)

        # running again must not queue duplicates
        self.go(client, s, NOW + timedelta(hours=1))
        self.assertEqual(len(self.store.list_pending("t")), 2)

        # approve both: executed at the start of the next live run
        for p in pending:
            self.assertTrue(self.store.decide_pending(p["id"], True))
        self.go(client, s, NOW + timedelta(days=1))
        offs = [w[1] for w in client.writes if w[0] == "on" and w[2] is False]
        self.assertEqual(sorted(offs), ["l0", "l1", "l2", "l3", "l4"])
        self.assertEqual(self.store.list_pending("t"), [])
        self.assertEqual(self.store.load_states("t")["l3"].bot_off_reason, LEAK_NO_CONV)

    def test_rejected_proposals_are_not_nagged_for_a_week(self):
        client, s = build(n_leak=5, n_good=5)
        self.go(client, s, NOW)
        for p in self.store.list_pending("t"):
            self.store.decide_pending(p["id"], False, at=NOW)
        self.go(client, s, NOW + timedelta(days=1))
        self.assertEqual(self.store.list_pending("t"), [])
        self.assertFalse([w for w in client.writes if w[1] in ("l3", "l4")])
        self.go(client, s, NOW + timedelta(days=8))
        # after the cool-off the normal rules apply again (here: within the daily gate -> switched off)
        self.assertIn(("on", "l3", False), client.writes)
        self.assertIn(("on", "l4", False), client.writes)

    def test_approval_expires_when_state_changed(self):
        client, s = build(n_leak=5, n_good=5)
        self.go(client, s, NOW)
        pending = self.store.list_pending("t")
        for p in pending:
            self.store.decide_pending(p["id"], True)
        for u in client.units:  # a human switched l3 off by hand in the meantime
            if u.id == "l3":
                u.on = False
        self.go(client, s, NOW + timedelta(days=1))
        self.assertNotIn(("on", "l3", False), client.writes)
        statuses = {p["unit_id"]: self.store.conn.execute("SELECT status FROM actions WHERE id=?", (p["id"],)).fetchone()[0]
                    for p in pending}
        self.assertEqual(statuses, {"l3": st.EXPIRED, "l4": st.APPLIED})


if __name__ == "__main__":
    unittest.main()
