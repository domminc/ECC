import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from autopilot.cli import main as cli_main
from autopilot.config import ConfigError, load_config
from autopilot.notify import Notifier
from autopilot.report import build_digest, format_text, render_html
from autopilot.runner import run_site
from autopilot.simulator import compare, run_simulation
from autopilot.store import Store
from tests.helpers import NOW, FakeClient, make_unit, site
from autopilot.models import Stats

ROOT = Path(__file__).resolve().parent.parent


class SimulatorTests(unittest.TestCase):
    def test_autopilot_beats_doing_nothing_on_several_markets(self):
        for seed in (7, 11, 23):
            res = compare(days=40, seed=seed)
            base, auto = res["baseline"], res["autopilot"]
            self.assertLess(auto["leak_share"], base["leak_share"], seed)
            self.assertGreater(auto["roas"], base["roas"] * 1.3, seed)
            self.assertGreater(auto["profit"], base["profit"], seed)

    def test_simulation_is_deterministic(self):
        self.assertEqual(run_simulation(20, 3), run_simulation(20, 3))

    def test_bid_changes_stay_calm(self):
        auto = run_simulation(45, 7)
        self.assertLess(auto["actions"] / (45 * 40), 0.35)  # well under one change per unit every 3 days


class ConfigTests(unittest.TestCase):
    def write(self, text):
        fd, path = tempfile.mkstemp(suffix=".toml")
        os.write(fd, text.encode("utf-8"))
        os.close(fd)
        self.addCleanup(os.remove, path)
        return path

    def test_example_config_loads(self):
        cfg = load_config(str(ROOT / "config.example.toml"))
        s = cfg.sites["site_a"]
        self.assertEqual((s.target_roas_pct, s.level, s.campaign_types), (500, "adgroup", ["SHOPPING"]))
        self.assertEqual(cfg.global_.utc_offset_hours, 9)

    def test_typos_are_errors(self):
        path = self.write("[sites.a]\ntarget_roas = 400\n")
        with self.assertRaises(ConfigError):
            load_config(path)

    def test_invalid_values_are_rejected(self):
        for body in ("target_roas_pct = 0", "max_step_pct = 0.9", "min_bid = 500\nmax_bid = 100",
                     "off_hours = [[1, 30]]", 'level = "campaign"', "max_off_pct_per_day = 0"):
            with self.assertRaises(ConfigError, msg=body):
                load_config(self.write(f"[sites.a]\n{body}\n"))

    def test_needs_at_least_one_site(self):
        with self.assertRaises(ConfigError):
            load_config(self.write("[global]\ndb_path = 'x.db'\n"))


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        units = [make_unit(f"l{i}") for i in range(5)] + [make_unit(f"h{i}") for i in range(5)]
        lookback = {f"l{i}": Stats(3600, 120, 30_000, 0, 0) for i in range(5)}
        lookback.update({f"h{i}": Stats(3000, 100, 20_000, 5, 100_000) for i in range(5)})
        self.client = FakeClient(units, lookback=lookback, today_date=NOW.date())
        run_site(site(), self.client, self.store, Notifier(out=lambda *_: None), NOW, dry_run=False)

    def test_digest_flags_pending_approvals_as_warn(self):
        digest = build_digest(self.store, ["t"], NOW + timedelta(hours=1))
        s = digest["sites"][0]
        self.assertEqual((s["signal"], len(s["pending"])), ("warn", 2))
        text = format_text(digest)
        self.assertIn("승인 대기 2건", text)
        self.assertIn("LEAK_NO_CONV", text)

    def test_html_is_escaped_and_self_contained(self):
        digest = build_digest(self.store, ["t"], NOW)
        digest["sites"][0]["alerts"].append({"site": "t", "level": "warn", "message": "<script>alert(1)</script>"})
        out = render_html(digest)
        self.assertNotIn("<script>alert(1)</script>", out)
        self.assertIn("&lt;script&gt;", out)
        self.assertTrue(out.startswith("<!doctype html>"))

    def test_critical_when_data_looks_broken(self):
        store = Store()
        client = FakeClient([make_unit("a"), make_unit("b")],
                            lookback={"a": Stats(6000, 200, 40_000, 0, 0), "b": Stats(6000, 200, 40_000, 0, 0)},
                            today_date=NOW.date())
        run_site(site(), client, store, Notifier(out=lambda *_: None), NOW, dry_run=False)
        self.assertEqual(build_digest(store, ["t"], NOW)["sites"][0]["signal"], "critical")


class CliTests(unittest.TestCase):
    def test_simulate_command_runs_offline(self):
        self.assertEqual(cli_main(["simulate", "--days", "12", "--units", "10"]), 0)

    def test_bad_config_path_is_a_clean_error(self):
        self.assertEqual(cli_main(["report", "--config", "/nonexistent/config.toml"]), 2)

    def test_run_without_credentials_exits_cleanly(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "c.toml"
            cfg.write_text(f'[global]\ndb_path = "{tmp}/a.db"\nkill_switch_file = "{tmp}/KILL"\n'
                           '[sites.a]\ncustomer_id_env = "NOPE_C"\napi_key_env = "NOPE_K"\nsecret_env = "NOPE_S"\n',
                           encoding="utf-8")
            self.assertEqual(cli_main(["run", "--config", str(cfg)]), 2)

    def test_kill_switch_command_creates_and_removes_the_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "c.toml"
            kill = Path(tmp) / "KILL"
            cfg.write_text(f'[global]\ndb_path = "{tmp}/a.db"\nkill_switch_file = "{kill}"\n[sites.a]\n', encoding="utf-8")
            self.assertEqual(cli_main(["kill", "--config", str(cfg)]), 0)
            self.assertTrue(kill.exists())
            self.assertEqual(cli_main(["kill", "--config", str(cfg), "--resume"]), 0)
            self.assertFalse(kill.exists())


if __name__ == "__main__":
    unittest.main()
