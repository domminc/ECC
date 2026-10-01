"""TOML configuration with strict validation (unknown keys are errors)."""

from __future__ import annotations

try:
    import tomllib
except ModuleNotFoundError:  # Python < 3.11: pip install tomli
    import tomli as tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Optional


class ConfigError(ValueError):
    pass


@dataclass
class SiteConfig:
    key: str = ""
    name: str = ""

    # credentials are read from environment variables, never stored in the file
    customer_id_env: str = ""
    api_key_env: str = ""
    secret_env: str = ""

    level: str = "adgroup"  # "adgroup" | "keyword" | "ad" (shopping product ads)
    campaign_types: list = field(default_factory=lambda: ["SHOPPING"])
    ad_types: list = field(default_factory=lambda: ["SHOPPING_PRODUCT_AD"])  # used when level == "ad"

    # /stats field names. Defaults follow the official spec (purchase conversions);
    # run `probe` to confirm they are accepted for your account.
    stat_conversions_field: str = "purchaseCcnt"
    stat_revenue_field: str = "purchaseConvAmt"

    # goal
    target_roas_pct: float = 400.0
    avg_order_value: Optional[float] = None  # fallback: derived from site stats
    daily_budget_cap: int = 100_000  # KRW, whole site, VAT-inclusive
    backstop_campaign_budget: Optional[int] = None  # also set on the Naver campaign

    # evaluation window
    lookback_days: int = 14
    cost_multiplier: float = 1.0  # /stats salesAmt already includes VAT (official spec); keep 1.0
    roas_lag_adjust: float = 1.0  # >1 compensates for late-arriving conversions

    # leak / stop-loss
    leak_multiplier: float = 3.0
    leak_min_cost: float = 10_000.0
    stoploss_ratio: float = 0.3
    probe_threshold_factor: float = 0.5  # units that already leaked once get less rope on re-entry

    # bid adjustment
    min_clicks: int = 30
    prior_clicks: int = 30
    bid_alpha: float = 0.5
    max_step_pct: float = 0.20
    deadband_pct: float = 0.05
    cooldown_hours: float = 20.0
    min_bid: int = 70
    max_bid: int = 3000
    bid_unit: int = 10

    # schedule: list of [start_hour, end_hour) windows during which ads are off
    off_hours: list = field(default_factory=list)

    # re-entry of leak-off units
    resume_days: int = 7
    resume_max_days: int = 60
    max_offs_before_review: int = 3
    max_resumes_per_run: int = 3

    # guardrails
    max_off_pct_per_day: float = 0.25  # share of active units that may be switched off per 24h
    max_off_floor: int = 2
    defensive_ratio: float = 0.5
    sanity_min_cost: float = 30_000.0
    max_actions_per_run: int = 200

    # protection
    protected_ids: list = field(default_factory=list)
    protected_name_prefix: str = "[MANUAL]"


@dataclass
class GlobalConfig:
    db_path: str = "autopilot.db"
    kill_switch_file: str = "KILL"
    utc_offset_hours: int = 9  # KST
    webhook_url_envs: list = field(default_factory=list)  # env var names holding Slack/Discord webhook URLs
    total_daily_cap: Optional[int] = None  # KRW across all sites, VAT-inclusive
    request_min_interval: float = 0.25


@dataclass
class Config:
    global_: GlobalConfig
    sites: dict


def _build(cls, data: dict, where: str):
    allowed = {f.name for f in fields(cls)}
    unknown = set(data) - allowed
    if unknown:
        raise ConfigError(f"{where}: unknown keys {sorted(unknown)}")
    return cls(**data)


def validate_site(s: SiteConfig) -> None:
    where = f"sites.{s.key}"
    if s.level not in ("adgroup", "keyword", "ad"):
        raise ConfigError(f"{where}.level must be 'adgroup', 'keyword' or 'ad'")
    if s.target_roas_pct <= 0:
        raise ConfigError(f"{where}.target_roas_pct must be > 0")
    if s.cost_multiplier <= 0:
        raise ConfigError(f"{where}.cost_multiplier must be > 0")
    if s.daily_budget_cap <= 0:
        raise ConfigError(f"{where}.daily_budget_cap must be > 0")
    if not (0 < s.max_step_pct <= 0.5):
        raise ConfigError(f"{where}.max_step_pct must be in (0, 0.5]")
    if not (0 < s.bid_alpha <= 1):
        raise ConfigError(f"{where}.bid_alpha must be in (0, 1]")
    if s.min_bid <= 0 or s.max_bid < s.min_bid:
        raise ConfigError(f"{where}: need 0 < min_bid <= max_bid")
    if s.bid_unit <= 0:
        raise ConfigError(f"{where}.bid_unit must be > 0")
    if s.lookback_days < 1:
        raise ConfigError(f"{where}.lookback_days must be >= 1")
    if not (0 < s.max_off_pct_per_day <= 1):
        raise ConfigError(f"{where}.max_off_pct_per_day must be in (0, 1]")
    for window in s.off_hours:
        if len(window) != 2 or not all(isinstance(h, int) and 0 <= h <= 24 for h in window):
            raise ConfigError(f"{where}.off_hours entries must be [start, end] hours in 0..24")


def load_config(path: str) -> Config:
    raw = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    global_ = _build(GlobalConfig, raw.get("global", {}), "global")
    sites = {}
    for key, data in raw.get("sites", {}).items():
        site = _build(SiteConfig, {**data, "key": key}, f"sites.{key}")
        validate_site(site)
        sites[key] = site
    if not sites:
        raise ConfigError("no [sites.*] sections found")
    if global_.total_daily_cap is not None and global_.total_daily_cap <= 0:
        raise ConfigError("global.total_daily_cap must be > 0")
    return Config(global_=global_, sites=sites)
