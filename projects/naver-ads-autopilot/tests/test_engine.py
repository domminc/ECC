import unittest
from datetime import datetime, timedelta

from autopilot.engine import decide, in_off_hours, leak_threshold, propose_bid
from autopilot.models import (
    BUDGET_CAP, LEAK_NO_CONV, RESUME_BUDGET, RESUME_PROBE, RESUME_SCHEDULE, ROAS_HIGH, ROAS_LOW,
    ROAS_STOPLOSS, SCHEDULE_OFF, Stats, UnitState,
)
from tests.helpers import NOW, actions_for, healthy, leaker, site, view


class ProposeBidTests(unittest.TestCase):
    """Numbers match the worked examples on slide 8 of the planning deck."""

    def test_example_a_bid_goes_down(self):
        new, code, est = propose_bid(site(), 400, Stats(120 * 30, 120, 36_000, 4, 120_000), 900)
        self.assertEqual((new, code), (340, ROAS_LOW))
        self.assertAlmostEqual(est, 2.9697, places=3)

    def test_example_b_bid_goes_up(self):
        new, code, est = propose_bid(site(), 500, Stats(80 * 30, 80, 20_000, 3, 140_000), 900)
        self.assertEqual((new, code), (590, ROAS_HIGH))
        self.assertAlmostEqual(est, 5.5207, places=3)

    def test_step_is_capped_at_20_percent(self):
        new, code, _ = propose_bid(site(), 400, Stats(3000, 100, 10_000, 10, 500_000), 500)
        self.assertEqual((new, code), (480, ROAS_HIGH))

    def test_low_data_is_left_alone(self):  # TC-05
        self.assertEqual(propose_bid(site(), 400, Stats(300, 10, 3_000, 0, 0), 900)[:2], (None, "LOW_DATA"))

    def test_deadband_ignores_tiny_moves(self):
        # est ROAS 420% vs target 400% -> +2.5%, below the 5% deadband
        stats = Stats(3000, 100, 10_000, 5, 46_200)
        self.assertEqual(propose_bid(site(), 400, stats, 462)[:2], (None, "DEADBAND"))

    def test_never_leaves_min_max_bid(self):
        self.assertEqual(propose_bid(site(min_bid=70), 80, Stats(3000, 100, 30_000, 1, 1_000), 100)[0], 70)
        self.assertEqual(propose_bid(site(min_bid=70), 70, Stats(3000, 100, 30_000, 1, 1_000), 100)[:2],
                         (None, "UNCHANGED"))
        self.assertIsNone(propose_bid(site(max_bid=500), 500, Stats(3000, 100, 10_000, 10, 500_000), 500)[0])

    def test_step_limit_holds_for_many_bids(self):  # TC-03/04: +-20% and 10 won units
        for bid in range(100, 2000, 37):
            for stats in (Stats(3000, 100, 10_000, 10, 500_000), Stats(3000, 100, 30_000, 1, 1_000)):
                new, _, _ = propose_bid(site(), bid, stats, 500)
                if new is not None:
                    self.assertLessEqual(abs(new - bid), bid * 0.2 + 1e-9, (bid, new))
                    self.assertEqual(new % 10, 0)

    def test_zero_bid_is_ignored(self):
        self.assertEqual(propose_bid(site(), 0, Stats(3000, 100, 10_000, 5, 50_000), 500)[:2], (None, "NO_BID"))


class HelperTests(unittest.TestCase):
    def test_off_hours_including_wrap_around(self):
        s = site(off_hours=[[1, 7]])
        self.assertTrue(in_off_hours(s, 1) and in_off_hours(s, 6))
        self.assertFalse(in_off_hours(s, 7) or in_off_hours(s, 0))
        wrap = site(off_hours=[[23, 7]])
        self.assertTrue(in_off_hours(wrap, 23) and in_off_hours(wrap, 0) and in_off_hours(wrap, 6))
        self.assertFalse(in_off_hours(wrap, 12))

    def test_leak_threshold(self):
        self.assertEqual(leak_threshold(site(), Stats()), 22_500)  # 3 x (30,000 / 4)
        derived = site(avg_order_value=None)
        self.assertEqual(leak_threshold(derived, Stats(0, 100, 0, 5, 100_000)), 15_000)  # 3 x (20,000 / 4)
        # no order value known at all: conservative fallback = leak_min_cost x multiplier
        self.assertEqual(leak_threshold(derived, Stats()), 30_000)


class LeakTests(unittest.TestCase):
    def test_leak_is_switched_off(self):  # TC-01
        d = decide(site(), [leaker("l1", cost=21_000), healthy("h1"), healthy("h2")], NOW)
        acts = actions_for(d, "l1")
        self.assertEqual([(a.kind, a.code) for a in acts], [("off", LEAK_NO_CONV)])
        self.assertFalse(acts[0].needs_approval)

    def test_below_threshold_is_kept(self):  # TC-02
        d = decide(site(), [leaker("l1", cost=15_000), healthy("h1")], NOW)
        self.assertEqual([a for a in actions_for(d, "l1") if a.kind == "off"], [])

    def test_stoploss_uses_recent_data_only(self):
        awful = Stats(3000, 100, 25_000, 1, 10_000)  # ROAS 36% of 27.5k... well below 30% of target
        v = view("s1", lookback=awful, recent=awful)
        d = decide(site(), [v, healthy("h1")], NOW)
        self.assertEqual([(a.kind, a.code) for a in actions_for(d, "s1")], [("off", ROAS_STOPLOSS)])
        # same bad history, but the bid was fixed since: recent window is still empty -> no stop-loss
        fixed = view("s2", lookback=awful, recent=Stats())
        d = decide(site(), [fixed, healthy("h1")], NOW)
        self.assertEqual([a for a in actions_for(d, "s2") if a.kind == "off"], [])

    def test_reentered_units_get_a_cheaper_threshold(self):
        l = leaker("l1", cost=12_000)  # 13,200 with VAT: below 22,500 but above 11,250
        fresh = decide(site(), [l, healthy("h1")], NOW)
        self.assertEqual([a for a in actions_for(fresh, "l1") if a.kind == "off"], [])
        l2 = leaker("l1", cost=12_000, state=UnitState(off_count=1))
        again = decide(site(), [l2, healthy("h1")], NOW)
        self.assertEqual([a.code for a in actions_for(again, "l1") if a.kind == "off"], [LEAK_NO_CONV])

    def test_mass_off_is_gated_by_approval(self):  # TC-09
        leaks = [leaker(f"l{i}", cost=30_000 - i * 1_000) for i in range(5)]
        fine = [healthy(f"h{i}") for i in range(5)]
        d = decide(site(), leaks + fine, NOW)
        offs = [a for a in d.actions if a.kind == "off"]
        self.assertEqual(len(offs), 5)
        self.assertEqual([a.needs_approval for a in offs], [False, False, False, True, True])
        self.assertEqual([a.unit_id for a in offs], ["l0", "l1", "l2", "l3", "l4"])  # biggest leaks go first
        self.assertIn("OFF_NEEDS_APPROVAL", [a.key for a in d.alerts])


    def test_recent_offs_count_against_the_daily_gate(self):
        leaks = [leaker(f"l{i}", cost=30_000) for i in range(2)]
        fine = [healthy(f"h{i}") for i in range(5)]
        d = decide(site(), leaks + fine, NOW, offs_recent=3)  # 3 already switched off today
        self.assertEqual([a.needs_approval for a in d.actions if a.kind == "off"], [True, True])
        d = decide(site(), leaks + fine, NOW, offs_recent=0)
        self.assertEqual([a.needs_approval for a in d.actions if a.kind == "off"], [False, False])


class BidTests(unittest.TestCase):
    def mid_site_views(self):
        # unit A converts poorly but not terribly; filler unit sets the site average RPC to 900 won/click
        a = view("A", lookback=Stats(3600, 120, 36_000, 4, 120_000))
        filler = view("F", lookback=Stats(11_400, 380, 80_000, 11, 330_000))
        return [a, filler]

    def test_bid_goes_down_when_roas_is_low(self):  # TC-03
        d = decide(site(), self.mid_site_views(), NOW)
        a = [x for x in actions_for(d, "A") if x.kind == "bid"][0]
        self.assertEqual((a.old, a.new, a.code), (400, 340, ROAS_LOW))

    def test_bid_goes_up_when_roas_is_high(self):  # TC-04
        v = view("A", lookback=Stats(3000, 100, 10_000, 10, 500_000))
        d = decide(site(), [v, healthy("h1")], NOW)
        a = [x for x in actions_for(d, "A") if x.kind == "bid"][0]
        self.assertEqual((a.old, a.new, a.code), (400, 480, ROAS_HIGH))

    def test_cooldown_blocks_a_second_change(self):  # TC-06
        views = self.mid_site_views()
        views[0].state = UnitState(last_change_at=NOW - timedelta(hours=5))
        d = decide(site(), views, NOW)
        self.assertEqual([x for x in actions_for(d, "A") if x.kind == "bid"], [])
        views[0].state = UnitState(last_change_at=NOW - timedelta(hours=21))
        d = decide(site(), views, NOW)
        self.assertEqual(len([x for x in actions_for(d, "A") if x.kind == "bid"]), 1)

    def test_low_data_unit_is_untouched(self):  # TC-05
        d = decide(site(), [view("A", lookback=Stats(300, 10, 3_000, 0, 0)), healthy("h1")], NOW)
        self.assertEqual(actions_for(d, "A"), [])

    def test_defensive_mode_blocks_bid_increases(self):
        winner = view("W", lookback=Stats(3000, 100, 10_000, 10, 500_000))
        losers = [view(f"x{i}", lookback=Stats(3000, 100, 20_000, 1, 5_000)) for i in range(20)]
        d = decide(site(), [winner] + losers, NOW)
        self.assertTrue(d.summary["defensive"])
        self.assertIn("DEFENSIVE_MODE", [a.key for a in d.alerts])
        self.assertEqual([x for x in actions_for(d, "W") if x.kind == "bid"], [])


class BudgetAndScheduleTests(unittest.TestCase):
    def test_site_budget_cap_switches_everything_off(self):  # TC-07
        spent = Stats(3000, 100, 60_000, 3, 300_000)  # 66,000 with VAT each -> 132,000 > 100,000
        views = [view("a", today=spent), view("b", today=spent), healthy("c")]
        d = decide(site(), views, NOW)
        offs = [x for x in d.actions if x.kind == "off"]
        self.assertEqual({x.unit_id for x in offs}, {"a", "b", "c"})
        self.assertTrue(all(x.code == BUDGET_CAP and not x.needs_approval for x in offs))
        self.assertEqual([x for x in d.actions if x.kind == "bid"], [])

    def test_next_day_budget_cap_is_lifted(self):
        v = view("a", on=False, state=UnitState(bot_off_reason=BUDGET_CAP, bot_off_at=NOW - timedelta(hours=13)))
        d = decide(site(), [v, healthy("h")], NOW)
        self.assertEqual([(x.kind, x.code) for x in actions_for(d, "a")], [("on", RESUME_BUDGET)])

    def test_schedule_off_and_resume(self):
        s = site(off_hours=[[1, 7]])
        night = datetime(2026, 3, 10, 3, 0)
        d = decide(s, [healthy("h1"), healthy("h2")], night)
        self.assertEqual({(x.unit_id, x.kind, x.code) for x in d.actions},
                         {("h1", "off", SCHEDULE_OFF), ("h2", "off", SCHEDULE_OFF)})
        morning = datetime(2026, 3, 10, 8, 0)
        v = view("h1", on=False, state=UnitState(bot_off_reason=SCHEDULE_OFF, bot_off_at=night))
        d = decide(s, [v, healthy("h2")], morning)
        self.assertEqual([(x.kind, x.code) for x in actions_for(d, "h1")], [("on", RESUME_SCHEDULE)])

    def test_backstop_budget_is_set_once_per_campaign(self):
        s = site(backstop_campaign_budget=50_000)
        views = [healthy("a", campaign="c1"), healthy("b", campaign="c1"), healthy("c", campaign="c2", budget=40_000),
                 healthy("d", campaign="c3", budget=90_000)]
        d = decide(s, views, NOW)
        budgets = {x.unit_id: (x.old, x.new) for x in d.actions if x.kind == "campaign_budget"}
        self.assertEqual(budgets, {"c1": (None, 50_000), "c3": (90_000, 50_000)})


class SafetyTests(unittest.TestCase):
    def test_broken_conversion_tracking_freezes_performance_actions(self):  # TC-08
        views = [view(f"u{i}", lookback=Stats(6000, 200, 40_000, 0, 0)) for i in range(4)]
        d = decide(site(), views, NOW)
        self.assertTrue(d.summary["frozen"])
        self.assertEqual(d.actions, [])
        critical = [a for a in d.alerts if a.key == "TRACKING_SUSPECT"]
        self.assertEqual(len(critical), 1)
        self.assertEqual(critical[0].level, "critical")

    def test_missing_stats_freeze(self):
        d = decide(site(), [view("a"), view("b")], NOW)
        self.assertTrue(d.summary["frozen"])
        self.assertIn("NO_STATS", [a.key for a in d.alerts])

    def test_budget_defense_still_works_while_frozen(self):
        spent = Stats(0, 0, 200_000, 0, 0)
        d = decide(site(), [view("a", lookback=Stats(6000, 200, 200_000, 0, 0), today=spent)], NOW)
        self.assertEqual([(x.kind, x.code) for x in d.actions], [("off", BUDGET_CAP)])

    def test_protected_units_are_never_touched(self):  # TC-12
        s = site(protected_ids=["p1"])
        views = [leaker("p1", cost=50_000), leaker("m1", cost=50_000, name="[MANUAL] 시즌 상품"), healthy("h1")]
        d = decide(s, views, NOW)
        self.assertEqual(actions_for(d, "p1"), [])
        self.assertEqual(actions_for(d, "m1"), [])

    def test_units_paused_by_a_human_are_skipped(self):  # TC-12
        d = decide(site(), [leaker("l1", cost=50_000, parent_on=False), leaker("l2", cost=50_000, on=False),
                            healthy("h1")], NOW)
        self.assertEqual(actions_for(d, "l1"), [])
        self.assertEqual(actions_for(d, "l2"), [])


class ReentryTests(unittest.TestCase):
    def off_view(self, days_ago, off_count):
        return view("l1", on=False, state=UnitState(bot_off_reason=LEAK_NO_CONV, bot_off_at=NOW - timedelta(days=days_ago),
                                                    off_count=off_count))

    def test_first_reentry_after_7_days(self):
        self.assertEqual(actions_for(decide(site(), [self.off_view(6, 1), healthy("h1")], NOW), "l1"), [])
        acts = actions_for(decide(site(), [self.off_view(8, 1), healthy("h1")], NOW), "l1")
        self.assertEqual([(a.kind, a.code, a.reset_eval) for a in acts], [("on", RESUME_PROBE, True)])

    def test_backoff_doubles_each_time(self):
        self.assertEqual(actions_for(decide(site(), [self.off_view(10, 2), healthy("h1")], NOW), "l1"), [])
        self.assertEqual(len(actions_for(decide(site(), [self.off_view(15, 2), healthy("h1")], NOW), "l1")), 1)

    def test_third_strike_asks_for_review(self):
        d = decide(site(), [self.off_view(90, 3), healthy("h1")], NOW)
        self.assertEqual(actions_for(d, "l1"), [])
        self.assertIn("REVIEW:l1", [a.key for a in d.alerts])

    def test_no_reentry_in_defensive_mode(self):
        losers = [view(f"x{i}", lookback=Stats(3000, 100, 20_000, 1, 5_000)) for i in range(20)]
        d = decide(site(), [self.off_view(30, 1)] + losers, NOW)
        self.assertTrue(d.summary["defensive"])
        self.assertEqual(actions_for(d, "l1"), [])


if __name__ == "__main__":
    unittest.main()
