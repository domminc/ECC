"""Synthetic ad market for testing the autopilot end to end (no network).

The market is made up: it demonstrates that the *logic* removes leaks and moves
bids toward the target ROAS under the assumptions below. It is not evidence of
real-world performance. Baseline and autopilot runs share random draws per
(unit, day), so differences come from decisions only.
"""

from __future__ import annotations

import math
import random
from datetime import date, datetime, time, timedelta
from typing import Optional

from .config import SiteConfig
from .models import Stats, Unit
from .notify import Notifier
from .runner import run_site
from .store import Store

REF_BID = 400
CPC_FACTOR = 0.7  # realized CPC as a share of the bid (second-price-like discount)
ELASTICITY = 0.8  # clicks ~ (bid / REF_BID) ** ELASTICITY
IMPRESSIONS_PER_CLICK = 30


def _poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    if lam > 30:
        return max(0, int(round(rng.gauss(lam, math.sqrt(lam)))))
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        k += 1
        p *= rng.random()
        if p <= limit:
            return k - 1


class SimWorld:
    def __init__(self, seed: int = 7, n_units: int = 40, start: date = date(2026, 1, 1),
                 leaky_share: float = 0.25, good_share: float = 0.25, base_bid: int = 400):
        self.seed = seed
        self.start = start
        rng = random.Random(seed)
        self.units: dict = {}
        for i in range(n_units):
            roll = rng.random()
            if roll < leaky_share:
                kind, cvr = "leaky", 0.001
            elif roll < leaky_share + good_share:
                kind, cvr = "good", rng.uniform(0.04, 0.06)
            else:
                kind, cvr = "mid", rng.uniform(0.015, 0.025)
            uid = f"grp-{i:03d}"
            self.units[uid] = {
                "id": uid, "name": f"광고그룹 {i:03d}", "kind": kind, "cvr": cvr,
                "aov": 30_000 * rng.uniform(0.7, 1.3),
                "base_clicks": max(5.0, rng.lognormvariate(math.log(22), 0.5)),
                "on": True, "bid": base_bid,
            }
        self.history: dict = {uid: {} for uid in self.units}

    def simulate_day(self, day_index: int) -> date:
        day = self.start + timedelta(days=day_index)
        for uid, u in self.units.items():
            if not u["on"]:
                self.history[uid][day] = Stats()
                continue
            rng = random.Random(f"{self.seed}|{uid}|{day_index}")
            mean_clicks = u["base_clicks"] * (u["bid"] / REF_BID) ** ELASTICITY
            clicks = _poisson(rng, mean_clicks)
            conversions = sum(1 for _ in range(clicks) if rng.random() < u["cvr"])
            revenue = sum(u["aov"] * rng.uniform(0.8, 1.2) for _ in range(conversions))
            self.history[uid][day] = Stats(
                impressions=clicks * IMPRESSIONS_PER_CLICK, clicks=clicks,
                cost=clicks * CPC_FACTOR * u["bid"], conversions=conversions, revenue=revenue)
        return day


class SimClient:
    """Same interface as NaverSearchAdClient, backed by a SimWorld."""

    def __init__(self, world: SimWorld):
        self.world = world
        self.writes = 0

    def list_units(self) -> list:
        return [Unit(id=u["id"], name=u["name"], level="adgroup", campaign_id="camp-1",
                     on=u["on"], bid=u["bid"]) for u in self.world.units.values()]

    def get_stats(self, ids: list, since: date, until: date) -> dict:
        out = {}
        for uid in ids:
            total = Stats()
            for day, s in self.world.history[uid].items():
                if since <= day <= until:
                    total = total + s
            out[uid] = total
        return out

    def set_unit_on(self, unit: Unit, on: bool) -> None:
        self.world.units[unit.id]["on"] = on
        self.writes += 1

    def set_bid(self, unit: Unit, bid: int) -> None:
        self.world.units[unit.id]["bid"] = int(bid)
        self.writes += 1

    def set_campaign_budget(self, campaign_id: str, amount: int) -> None:
        self.writes += 1


def default_sim_site() -> SiteConfig:
    return SiteConfig(key="sim", name="Simulation", target_roas_pct=400, daily_budget_cap=2_000_000)


def run_simulation(days: int = 45, seed: int = 7, autopilot: bool = True,
                   site: Optional[SiteConfig] = None, margin: float = 0.35, n_units: int = 40) -> dict:
    site = site or default_sim_site()
    world = SimWorld(seed=seed, n_units=n_units)
    client = SimClient(world)
    store = Store()
    notifier = Notifier(out=lambda *_: None)
    actions_applied = 0

    for i in range(days):
        day = world.simulate_day(i)
        if autopilot:
            now = datetime.combine(day, time(23, 0))
            result = run_site(site, client, store, notifier, now, dry_run=False)
            actions_applied += result.applied

    total = Stats()
    leaky_cost = 0.0
    for uid, hist in world.history.items():
        unit_total = Stats()
        for s in hist.values():
            unit_total = unit_total + s
        total = total + unit_total
        if world.units[uid]["kind"] == "leaky":
            leaky_cost += unit_total.cost * site.cost_multiplier
    cost = total.cost * site.cost_multiplier
    return {
        "autopilot": autopilot, "days": days, "seed": seed,
        "cost": round(cost), "revenue": round(total.revenue), "clicks": total.clicks,
        "conversions": total.conversions,
        "roas": (total.revenue / cost) if cost else 0.0,
        "leak_cost": round(leaky_cost),
        "leak_share": (leaky_cost / cost) if cost else 0.0,
        "profit": round(total.revenue * margin - cost),
        "actions": actions_applied,
        "units_on_at_end": sum(1 for u in world.units.values() if u["on"]),
        "margin": margin,
    }


def compare(days: int = 45, seed: int = 7, **kwargs) -> dict:
    return {"baseline": run_simulation(days, seed, autopilot=False, **kwargs),
            "autopilot": run_simulation(days, seed, autopilot=True, **kwargs)}


def format_comparison(res: dict) -> str:
    b, a = res["baseline"], res["autopilot"]

    def line(label, key, fmt):
        return f"{label:<18}{fmt(b[key]):>16}{fmt(a[key]):>16}"

    won = lambda v: f"{v:,.0f}원"  # noqa: E731
    pct = lambda v: f"{v:.0%}"  # noqa: E731
    lines = [
        f"시뮬레이션 {b['days']}일 · seed {b['seed']} · 가정 마진율 {b['margin']:.0%}",
        f"{'':<18}{'자동화 없음':>16}{'오토파일럿':>16}",
        line("광고비(VAT 포함)", "cost", won),
        line("전환매출", "revenue", won),
        line("ROAS", "roas", pct),
        line("누수 광고비", "leak_cost", won),
        line("누수 비율", "leak_share", pct),
        line("추정 이익*", "profit", won),
        line("실행한 변경 수", "actions", lambda v: f"{v:,}건"),
        "",
        "* 추정 이익 = 전환매출 × 마진율 - 광고비. 가상 시장이므로 실제 성과의 증거가 아니라 로직 검증용입니다.",
    ]
    return "\n".join(lines)
