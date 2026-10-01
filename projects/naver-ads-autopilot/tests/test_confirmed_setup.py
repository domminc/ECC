"""Features added for the Smartstore setup: product-ad level, official stat fields,
group prior, Slack/Discord, all-sites daily cap."""

import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

from autopilot.cli import _effective_cap, main as cli_main
from autopilot.config import ConfigError, SiteConfig, load_config
from autopilot.engine import decide, propose_bid
from autopilot.models import Stats, Unit, UnitState, UnitView
from autopilot.naver_client import ApiError, NaverSearchAdClient
from autopilot.notify import Notifier, payloads_for, split_for_discord, webhook_kind
from autopilot.runner import run_site
from autopilot.store import Store
from tests.helpers import NOW, FakeClient, make_unit, site
from tests.test_client import Script, make_client


class DefaultsTests(unittest.TestCase):
    """The deck's slide 8 examples, with the real default (salesAmt is already VAT-inclusive)."""

    def test_vat_is_not_added_twice(self):
        self.assertEqual(SiteConfig().cost_multiplier, 1.0)

    def test_deck_examples_with_default_multiplier(self):
        s = SiteConfig(target_roas_pct=400)
        a, code_a, est_a = propose_bid(s, 400, Stats(3600, 120, 36_000, 4, 120_000), 900)
        b, code_b, est_b = propose_bid(s, 500, Stats(2400, 80, 20_000, 3, 140_000), 900)
        self.assertEqual((a, code_a), (360, "ROAS_LOW"))
        self.assertAlmostEqual(est_a, 3.2667, places=3)
        self.assertEqual((b, code_b), (600, "ROAS_HIGH"))  # +20% cap
        self.assertAlmostEqual(est_b, 6.0727, places=3)


class AdLevelClientTests(unittest.TestCase):
    CAMPAIGNS = (200, [{"nccCampaignId": "c1", "campaignTp": "SHOPPING", "userLock": False}])
    GROUPS = (200, [{"nccAdgroupId": "g1", "name": "원피스", "userLock": False, "bidAmt": 300}])

    def test_lists_shopping_product_ads_only(self):
        ads = (200, [
            {"nccAdId": "a1", "type": "SHOPPING_PRODUCT_AD", "userLock": False, "status": "ELIGIBLE",
             "adAttr": json.dumps({"bidAmt": 450, "useGroupBidAmt": False}), "ad": json.dumps({"productName": "여름 원피스"})},
            {"nccAdId": "a2", "type": "SHOPPING_PRODUCT_AD", "userLock": True,
             "adAttr": {"bidAmt": 999, "useGroupBidAmt": True}},
            {"nccAdId": "a3", "type": "TEXT_45", "userLock": False},
            {"nccAdId": "a4", "type": "SHOPPING_PRODUCT_AD", "status": "DELETED"},
        ])
        client, _ = make_client(Script(self.CAMPAIGNS, self.GROUPS, ads), level="ad")
        units = client.list_units()
        self.assertEqual([(u.id, u.name, u.on, u.bid, u.uses_group_bid, u.adgroup_id) for u in units],
                         [("a1", "여름 원피스", True, 450, False, "g1"), ("a2", "원피스 / a2", False, 300, True, "g1")])

    def test_switching_an_ad_uses_the_documented_user_lock_field(self):
        script = Script((200, {"nccAdId": "a1", "userLock": False}), (200, {}))
        client, _ = make_client(script, level="ad")
        client.set_unit_on(Unit("a1", "a", "ad", "c1", True, 400), False)
        method, url, _, body = script.requests[1]
        self.assertEqual((method, url), ("PUT", "https://api.searchad.naver.com/ncc/ads/a1?fields=userLock"))
        self.assertIs(body["userLock"], True)

    def test_changing_an_ad_bid_keeps_adattr_type(self):
        as_string = (200, {"nccAdId": "a1", "adAttr": json.dumps({"bidAmt": 400, "useGroupBidAmt": True, "x": 1})})
        as_object = (200, {"nccAdId": "a2", "adAttr": {"bidAmt": 400}})
        script = Script(as_string, (200, {}), as_object, (200, {}))
        client, _ = make_client(script, level="ad")
        client.set_bid(Unit("a1", "a", "ad", "c1", True, 400), 360)
        client.set_bid(Unit("a2", "b", "ad", "c1", True, 400), 440)
        _, url1, _, body1 = script.requests[1]
        self.assertEqual(url1, "https://api.searchad.naver.com/ncc/ads/a1")  # no `fields`: whole ad is sent
        self.assertEqual(json.loads(body1["adAttr"]), {"bidAmt": 360, "useGroupBidAmt": False, "x": 1})
        self.assertEqual(script.requests[3][3]["adAttr"], {"bidAmt": 440})

    def test_campaign_budget_uses_documented_budget_field(self):
        script = Script((200, {"nccCampaignId": "c1"}), (200, {}))
        client, _ = make_client(script)
        client.set_campaign_budget("c1", 400_000)
        method, url, _, body = script.requests[1]
        self.assertEqual(url, "https://api.searchad.naver.com/ncc/campaigns/c1?fields=budget")
        self.assertEqual((body["useDailyBudget"], body["dailyBudget"]), (True, 400_000))


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.head = [(200, [{"nccCampaignId": "c1", "campaignTp": "SHOPPING"}]),
                     (200, [{"nccAdgroupId": "g1", "name": "g"}]),
                     (200, [{"nccAdId": "a1", "type": "SHOPPING_PRODUCT_AD"}])]

    def test_probe_reports_accepted_stat_fields(self):
        script = Script(*self.head, (200, {"data": [{"id": "g1", "purchaseConvAmt": 5}]}))
        client, _ = make_client(script)
        out = client.probe(date(2026, 3, 10))
        self.assertEqual(out["ad_types_seen"], ["SHOPPING_PRODUCT_AD"])
        self.assertIn("purchaseConvAmt", out["stats_fields"]["accepted"])
        self.assertNotIn("api_key", json.dumps(out).lower())

    def test_probe_falls_back_to_field_by_field(self):
        n_fields = 8
        singles = [(200, {"data": []}) if i % 2 == 0 else (400, {"code": 1002, "title": "bad field"})
                   for i in range(n_fields)]
        script = Script(*self.head, (400, {"code": 1002, "title": "bad field"}), *singles)
        client, _ = make_client(script)
        out = client.probe(date(2026, 3, 10))["stats_fields"]
        self.assertEqual(len(out["accepted"]), 4)
        self.assertEqual(len(out["rejected"]), 4)
        self.assertIn("combined_error", out)


class GroupPriorTests(unittest.TestCase):
    def ad_view(self, uid, group, stats, bid=400):
        unit = Unit(uid, uid, "ad", "c1", True, bid, adgroup_id=group)
        return UnitView(unit=unit, lookback=stats, today=Stats(), state=UnitState())

    def test_sparse_product_ads_borrow_their_group_revenue_per_click(self):
        s = site()
        sparse = Stats(900, 30, 3_000, 0, 0)
        strong_sibling = Stats(6000, 200, 20_000, 20, 600_000)
        weak_other_group = Stats(9000, 300, 60_000, 3, 30_000)
        views = [self.ad_view("u", "g1", sparse), self.ad_view("v", "g1", strong_sibling),
                 self.ad_view("w", "g2", weak_other_group)]
        d = decide(s, views, NOW)
        bid = [a for a in d.actions if a.unit_id == "u" and a.kind == "bid"][0]

        group_rpc = (0 + 600_000) / (200 + 30)  # clicks 30 + 200
        prior_rpc = group_rpc
        expected_est = ((0 + 30 * prior_rpc) / (30 + 30)) / (3_000 * 1.1 / 30)
        self.assertIn(f"{expected_est:.0%}", bid.reason)
        self.assertEqual((bid.old, bid.new), (400, 480))

    def test_adgroup_level_units_use_the_site_average(self):
        # same numbers, but adgroup-level units have no group to borrow from -> site prior
        s = site()
        views = [UnitView(unit=make_unit(uid), lookback=st, today=Stats(), state=UnitState())
                 for uid, st in (("u", Stats(900, 30, 3_000, 0, 0)), ("v", Stats(6000, 200, 20_000, 20, 600_000)),
                                 ("w", Stats(9000, 300, 60_000, 3, 30_000)))]
        d = decide(s, views, NOW)
        bid = [a for a in d.actions if a.unit_id == "u" and a.kind == "bid"]
        site_rpc = 630_000 / 530
        expected_est = ((30 * site_rpc) / 60) / (3_000 * 1.1 / 30)
        self.assertTrue(bid and f"{expected_est:.0%}" in bid[0].reason)


class NotifierTests(unittest.TestCase):
    SLACK = "https://hooks.slack.com/services/T000/B000/XXXX"
    DISCORD = "https://discord.com/api/webhooks/123/abc"

    def test_payload_shape_per_service(self):
        self.assertEqual((webhook_kind(self.SLACK), webhook_kind(self.DISCORD), webhook_kind("https://x.test/h")),
                         ("slack", "discord", "generic"))
        self.assertEqual(payloads_for(self.SLACK, "hi"), [{"text": "hi"}])
        self.assertEqual(payloads_for(self.DISCORD, "hi"), [{"content": "hi"}])

    def test_long_discord_messages_are_split(self):
        text = "\n".join(f"line {i:04d} " + "x" * 60 for i in range(100))
        chunks = split_for_discord(text)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(c) <= 1900 for c in chunks))
        self.assertEqual("\n".join(chunks), text)
        self.assertEqual(len(split_for_discord("y" * 4000)), 3)

    def test_levels_and_fanout(self):
        posts = []
        n = Notifier([self.SLACK, "", self.DISCORD], out=lambda *_: None, post=lambda u, p: posts.append((u, p)))
        n.send("info", "quiet")
        self.assertEqual(posts, [])
        n.send("warn", "careful", "details")
        self.assertEqual([u for u, _ in posts], [self.SLACK, self.DISCORD])
        n.send("info", "digest", "body", always_webhook=True)
        self.assertEqual(len(posts), 4)

    def test_broken_webhook_never_raises(self):
        def boom(url, payload):
            raise OSError("network down")
        Notifier([self.SLACK, self.DISCORD], out=lambda *_: None, post=boom).send("critical", "x")


class TotalCapTests(unittest.TestCase):
    def config(self):
        fd, path = tempfile.mkstemp(suffix=".toml")
        os.write(fd, b'[global]\ntotal_daily_cap = 400000\n[sites.a]\ndaily_budget_cap = 300000\n'
                     b'[sites.b]\ndaily_budget_cap = 300000\n')
        os.close(fd)
        self.addCleanup(os.remove, path)
        return load_config(path)

    def test_remaining_cap_accounts_for_other_sites(self):
        cfg, store = self.config(), Store()
        now = NOW
        run_id = store.start_run("b", now, False)
        store.finish_run(run_id, {"today_cost": 150_000})
        self.assertEqual(_effective_cap(cfg, store, cfg.sites["a"], now), 250_000)
        self.assertEqual(_effective_cap(cfg, store, cfg.sites["b"], now), 400_000)  # a has not run yet
        old = store.start_run("b", now.replace(day=9), False)  # yesterday's run must not count
        store.finish_run(old, {"today_cost": 999_999})
        self.assertEqual(_effective_cap(cfg, store, cfg.sites["a"], now), 250_000)

    def test_no_total_cap_means_no_override(self):
        fd, path = tempfile.mkstemp(suffix=".toml")
        os.write(fd, b'[sites.a]\n')
        os.close(fd)
        self.addCleanup(os.remove, path)
        self.assertIsNone(_effective_cap(load_config(path), Store(), load_config(path).sites["a"], NOW))

    def test_runner_applies_the_tighter_cap(self):
        units = [make_unit("a"), make_unit("b")]
        healthy = Stats(3000, 100, 20_000, 5, 100_000)
        spent = Stats(0, 0, 30_000, 0, 0)  # 33,000 each with the test VAT multiplier -> 66,000
        mk = lambda: FakeClient([make_unit("a"), make_unit("b")], lookback={"a": healthy, "b": healthy},  # noqa: E731
                                today={"a": spent, "b": spent}, today_date=NOW.date())
        s = site(daily_budget_cap=1_000_000)
        free = mk()
        run_site(s, free, Store(), Notifier(out=lambda *_: None), NOW, dry_run=False)
        self.assertEqual([w for w in free.writes if w[0] == "on" and w[2] is False], [])
        capped = mk()
        run_site(s, capped, Store(), Notifier(out=lambda *_: None), NOW, dry_run=False, daily_cap=50_000)
        self.assertEqual(sorted(w[1] for w in capped.writes if w[0] == "on" and w[2] is False), ["a", "b"])

    def test_config_rejects_bad_new_values(self):
        for body in ("[global]\ntotal_daily_cap = 0\n[sites.a]\n", '[sites.a]\ncost_multiplier = 0\n'):
            fd, path = tempfile.mkstemp(suffix=".toml")
            os.write(fd, body.encode())
            os.close(fd)
            self.addCleanup(os.remove, path)
            with self.assertRaises(ConfigError):
                load_config(path)


class ReportSendTests(unittest.TestCase):
    def test_report_send_posts_to_slack_and_discord(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "c.toml"
            cfg.write_text(f'[global]\ndb_path = "{tmp}/a.db"\nwebhook_url_envs = ["T_SLACK", "T_DISCORD"]\n'
                           '[sites.a]\n', encoding="utf-8")
            env = {"T_SLACK": "https://hooks.slack.com/services/T/B/X", "T_DISCORD": "https://discord.com/api/webhooks/1/a"}
            with mock.patch.dict(os.environ, env), mock.patch("autopilot.notify.urllib.request.urlopen") as opened:
                self.assertEqual(cli_main(["report", "--config", str(cfg), "--send"]), 0)
            urls = [call.args[0].full_url for call in opened.call_args_list]
            self.assertEqual(urls, [env["T_SLACK"], env["T_DISCORD"]])
            bodies = [json.loads(call.args[0].data) for call in opened.call_args_list]
            self.assertIn("text", bodies[0])
            self.assertIn("content", bodies[1])

    def test_report_send_without_webhooks_is_a_clean_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "c.toml"
            cfg.write_text(f'[global]\ndb_path = "{tmp}/a.db"\n[sites.a]\n', encoding="utf-8")
            self.assertEqual(cli_main(["report", "--config", str(cfg), "--send"]), 2)


if __name__ == "__main__":
    unittest.main()
