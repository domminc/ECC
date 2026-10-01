"""Plain data types shared by the engine, client, store and simulator."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional


@dataclass(frozen=True)
class Stats:
    """Aggregated performance for a date range. Money is in KRW as reported."""

    impressions: int = 0
    clicks: int = 0
    cost: float = 0.0
    conversions: float = 0.0
    revenue: float = 0.0

    def __add__(self, other: "Stats") -> "Stats":
        return Stats(
            self.impressions + other.impressions,
            self.clicks + other.clicks,
            self.cost + other.cost,
            self.conversions + other.conversions,
            self.revenue + other.revenue,
        )


EMPTY_STATS = Stats()


@dataclass
class Unit:
    """One thing the autopilot can switch on/off and re-bid (ad group or keyword)."""

    id: str
    name: str
    level: str  # "adgroup" | "keyword" | "ad"
    campaign_id: str
    on: bool
    bid: int
    parent_on: bool = True  # campaign (and ad group, for keywords) not paused by a human
    uses_group_bid: bool = False
    campaign_daily_budget: Optional[int] = None  # None = unlimited
    adgroup_id: Optional[str] = None


@dataclass
class UnitState:
    """What the autopilot remembers about a unit between runs."""

    last_change_at: Optional[datetime] = None
    bot_off_reason: Optional[str] = None
    bot_off_at: Optional[datetime] = None
    off_count: int = 0  # number of performance-based OFFs (leak / stop-loss)
    eval_since: Optional[date] = None  # ignore stats before this date after a re-entry


@dataclass
class UnitView:
    unit: Unit
    lookback: Stats  # full evaluation window (leak detection)
    today: Stats
    state: UnitState
    # Only data after the unit's last change, so a bid is judged on its own results.
    # None means "same as lookback" (handy in tests).
    recent: Optional[Stats] = None

    @property
    def recent_stats(self) -> Stats:
        return self.lookback if self.recent is None else self.recent


@dataclass
class Action:
    kind: str  # "bid" | "on" | "off" | "campaign_budget"
    unit_id: str  # campaign id for kind == "campaign_budget"
    unit_name: str
    code: str
    reason: str
    old: Optional[float] = None
    new: Optional[float] = None
    needs_approval: bool = False
    reset_eval: bool = False


@dataclass
class Alert:
    key: str
    level: str  # "info" | "warn" | "critical"
    message: str


@dataclass
class Decision:
    actions: list
    alerts: list
    summary: dict


# Reason codes. Keep stable: they are stored in the audit log.
LEAK_NO_CONV = "LEAK_NO_CONV"
ROAS_STOPLOSS = "ROAS_STOPLOSS"
ROAS_LOW = "ROAS_LOW"
ROAS_HIGH = "ROAS_HIGH"
BUDGET_CAP = "BUDGET_CAP"
SCHEDULE_OFF = "SCHEDULE_OFF"
RESUME_SCHEDULE = "RESUME_SCHEDULE"
RESUME_BUDGET = "RESUME_BUDGET"
RESUME_PROBE = "RESUME_PROBE"
BACKSTOP_BUDGET = "BACKSTOP_BUDGET"

LEAK_CODES = (LEAK_NO_CONV, ROAS_STOPLOSS)
REVERSIBLE_CODES = (SCHEDULE_OFF, BUDGET_CAP)
