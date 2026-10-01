from datetime import datetime

from autopilot.config import SiteConfig
from autopilot.models import Stats, Unit, UnitState, UnitView

NOW = datetime(2026, 3, 10, 12, 0)


def site(**overrides) -> SiteConfig:
    # cost_multiplier=1.1 on purpose: the engine tests exercise the VAT-multiplier path.
    # The real default (1.0, salesAmt is VAT-inclusive) is covered in test_defaults.
    base = dict(key="t", target_roas_pct=400, avg_order_value=30000, daily_budget_cap=100_000,
                cost_multiplier=1.1)
    return SiteConfig(**{**base, **overrides})


def make_unit(uid="u1", bid=400, on=True, name=None, campaign="c1", parent_on=True, budget=None) -> Unit:
    return Unit(id=uid, name=name or f"광고그룹 {uid}", level="adgroup", campaign_id=campaign, on=on,
                bid=bid, parent_on=parent_on, campaign_daily_budget=budget)


def view(uid="u1", bid=400, on=True, lookback=None, today=None, state=None, recent=None,
         name=None, campaign="c1", parent_on=True, budget=None) -> UnitView:
    return UnitView(unit=make_unit(uid, bid, on, name, campaign, parent_on, budget),
                    lookback=lookback or Stats(), today=today or Stats(),
                    state=state or UnitState(), recent=recent)


def healthy(uid="h1", bid=400, clicks=100, cost=20_000, conversions=5, revenue=100_000, **kw) -> UnitView:
    """A unit that converts well (ROAS ~450% after VAT)."""
    return view(uid, bid, lookback=Stats(clicks * 30, clicks, cost, conversions, revenue), **kw)


def leaker(uid="l1", cost=30_000, clicks=120, **kw) -> UnitView:
    """A unit that burns money without a single conversion."""
    return view(uid, lookback=Stats(clicks * 30, clicks, cost, 0, 0), **kw)


def actions_for(decision, uid):
    return [a for a in decision.actions if a.unit_id == uid]


class FakeClient:
    """Minimal in-memory client; records every write."""

    def __init__(self, units, lookback=None, today=None, today_date=None):
        self.units = units
        self.lookback = lookback or {}
        self.today = today or {}
        self.today_date = today_date
        self.writes = []
        self.stat_calls = []
        self.list_calls = 0
        self.fail_stats = None
        self.fail_write = None

    def list_units(self):
        self.list_calls += 1
        return self.units

    def get_stats(self, ids, since, until):
        if self.fail_stats:
            raise self.fail_stats
        self.stat_calls.append((since, until, tuple(ids)))
        source = self.today if (since == until == self.today_date) else self.lookback
        return {i: source.get(i, Stats()) for i in ids}

    def _write(self, record):
        if self.fail_write:
            raise self.fail_write
        self.writes.append(record)

    def set_unit_on(self, unit, on):
        self._write(("on", unit.id, on))

    def set_bid(self, unit, bid):
        self._write(("bid", unit.id, bid))

    def set_campaign_budget(self, campaign_id, amount):
        self._write(("budget", campaign_id, amount))
