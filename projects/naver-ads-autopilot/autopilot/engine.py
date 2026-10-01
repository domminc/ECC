"""Decision engine: pure functions, no I/O.

Order of precedence inside one run (earlier wins):
  0. sanity checks   -> may freeze every performance-based action
  1. budget defense  -> site spend today >= cap: switch everything off
  2. schedule        -> off-hours windows
  3. leak detection  -> switch off units that burn money without converting
  4. bid adjustment  -> move bids toward the target ROAS
  5. re-entry        -> probe previously leak-off units again, with back-off
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Optional

from .config import SiteConfig
from .models import (
    BACKSTOP_BUDGET,
    BUDGET_CAP,
    LEAK_CODES,
    LEAK_NO_CONV,
    RESUME_BUDGET,
    RESUME_PROBE,
    RESUME_SCHEDULE,
    ROAS_HIGH,
    ROAS_LOW,
    ROAS_STOPLOSS,
    SCHEDULE_OFF,
    Action,
    Alert,
    Decision,
    Stats,
    Unit,
    UnitView,
)


# ---------------------------------------------------------------- helpers

def eff_cost(site: SiteConfig, s: Stats) -> float:
    return s.cost * site.cost_multiplier


def eff_revenue(site: SiteConfig, s: Stats) -> float:
    return s.revenue * site.roas_lag_adjust


def roas_of(site: SiteConfig, s: Stats) -> Optional[float]:
    cost = eff_cost(site, s)
    return eff_revenue(site, s) / cost if cost > 0 else None


def target_ratio(site: SiteConfig) -> float:
    return site.target_roas_pct / 100.0


def in_off_hours(site: SiteConfig, hour: int) -> bool:
    for start, end in site.off_hours:
        if start <= end:
            if start <= hour < end:
                return True
        elif hour >= start or hour < end:  # window wraps midnight, e.g. [23, 7]
            return True
    return False


def leak_threshold(site: SiteConfig, site_lookback: Stats) -> float:
    """Spend (VAT-inclusive) beyond which zero conversions counts as a leak."""
    aov = site.avg_order_value
    if not aov and site_lookback.conversions > 0:
        aov = site_lookback.revenue / site_lookback.conversions
    allowable_cpa = aov / target_ratio(site) if aov else site.leak_min_cost
    return max(site.leak_min_cost, site.leak_multiplier * allowable_cpa)


def _round_half_up(x: float) -> int:
    return int(math.floor(x + 0.5))


def propose_bid(site: SiteConfig, bid: int, stats: Stats, site_rpc: float):
    """Return (new_bid | None, code_or_skip_reason, estimated_roas | None)."""
    if bid <= 0:
        return None, "NO_BID", None
    if stats.clicks < site.min_clicks:
        return None, "LOW_DATA", None
    cpc = eff_cost(site, stats) / stats.clicks
    if cpc <= 0:
        return None, "NO_COST", None

    k = site.prior_clicks
    rpc = (eff_revenue(site, stats) + k * site_rpc) / (stats.clicks + k)
    est_roas = rpc / cpc
    factor = (est_roas / target_ratio(site)) ** site.bid_alpha
    factor = min(1 + site.max_step_pct, max(1 - site.max_step_pct, factor))

    unit = site.bid_unit
    new = _round_half_up(bid * factor / unit) * unit
    lo = math.ceil(bid * (1 - site.max_step_pct) / unit) * unit
    hi = math.floor(bid * (1 + site.max_step_pct) / unit) * unit
    if lo <= hi:
        new = min(hi, max(lo, new))
    new = min(site.max_bid, max(site.min_bid, new))

    if new == bid:
        return None, "UNCHANGED", est_roas
    if abs(new - bid) / bid < site.deadband_pct:
        return None, "DEADBAND", est_roas
    return new, (ROAS_LOW if new < bid else ROAS_HIGH), est_roas


def _protected(site: SiteConfig, unit: Unit) -> bool:
    if unit.id in site.protected_ids:
        return True
    return bool(site.protected_name_prefix) and unit.name.startswith(site.protected_name_prefix)


def _sum(stats_list) -> Stats:
    total = Stats()
    for s in stats_list:
        total = total + s
    return total


# ---------------------------------------------------------------- decide

def decide(site: SiteConfig, views: list, now: datetime, offs_recent: int = 0) -> Decision:
    """offs_recent: leak-offs already applied in the last 24h (counts against the approval gate)."""
    actions: list = []
    alerts: list = []
    target = target_ratio(site)

    site_lb = _sum(v.lookback for v in views)
    site_today = _sum(v.today for v in views)
    managed = [v for v in views if v.unit.parent_on and not _protected(site, v.unit)]
    on_managed = [v for v in managed if v.unit.on]

    lb_cost = eff_cost(site, site_lb)
    site_roas = roas_of(site, site_lb)

    # ---- 0. sanity: never act on data that looks broken --------------------
    frozen = False
    if lb_cost >= site.sanity_min_cost and site_lb.conversions == 0:
        frozen = True
        alerts.append(Alert(
            "TRACKING_SUSPECT", "critical",
            f"[{site.key}] 최근 {site.lookback_days}일 광고비 {lb_cost:,.0f}원인데 전환이 0건입니다. "
            "전환추적 장애가 의심되어 성과 기반 조정을 모두 멈춥니다."))
    elif on_managed and site_lb.cost == 0 and site_lb.impressions == 0:
        frozen = True
        alerts.append(Alert(
            "NO_STATS", "warn",
            f"[{site.key}] 성과 데이터가 비어 있습니다. 데이터가 확인될 때까지 성과 기반 조정을 멈춥니다."))

    defensive = (
        not frozen and site_roas is not None and lb_cost >= site.sanity_min_cost
        and site_roas < site.defensive_ratio * target
    )
    if defensive:
        alerts.append(Alert(
            "DEFENSIVE_MODE", "warn",
            f"[{site.key}] 사이트 ROAS {site_roas:.0%}가 목표 {target:.0%}의 "
            f"{site.defensive_ratio:.0%} 미만입니다. 입찰 상향과 재진입을 막습니다."))

    # ---- backstop: platform-side daily budget so a dead bot cannot overspend
    if site.backstop_campaign_budget:
        seen = set()
        for v in managed:
            u = v.unit
            if u.campaign_id in seen:
                continue
            seen.add(u.campaign_id)
            if u.campaign_daily_budget is None or u.campaign_daily_budget > site.backstop_campaign_budget:
                actions.append(Action(
                    "campaign_budget", u.campaign_id, u.campaign_id, BACKSTOP_BUDGET,
                    f"캠페인 일 예산 백스톱 {site.backstop_campaign_budget:,}원",
                    old=u.campaign_daily_budget, new=site.backstop_campaign_budget))

    # ---- 1. budget defense --------------------------------------------------
    today_cost = eff_cost(site, site_today)
    over_cap = today_cost >= site.daily_budget_cap
    if over_cap:
        alerts.append(Alert(
            "BUDGET_CAP", "warn",
            f"[{site.key}] 오늘 광고비 {today_cost:,.0f}원이 상한 {site.daily_budget_cap:,}원에 도달해 "
            "모든 광고를 끕니다. 내일 자동 복구됩니다."))
        for v in on_managed:
            actions.append(Action("off", v.unit.id, v.unit.name, BUDGET_CAP,
                                  f"오늘 광고비 {today_cost:,.0f}원 ≥ 상한 {site.daily_budget_cap:,}원"))
        return _finish(site, views, managed, actions, alerts, frozen, defensive, site_lb, today_cost)
    if today_cost >= 0.8 * site.daily_budget_cap:
        alerts.append(Alert("BUDGET_80", "info",
                            f"[{site.key}] 오늘 광고비가 상한의 80%({today_cost:,.0f}원)를 넘었습니다."))

    # ---- 2. schedule --------------------------------------------------------
    off_now = in_off_hours(site, now.hour)
    for v in managed:
        if v.unit.on:
            continue
        if v.state.bot_off_reason == BUDGET_CAP and not off_now:
            actions.append(Action("on", v.unit.id, v.unit.name, RESUME_BUDGET, "새 날짜: 일 예산 상한 해제"))
        elif v.state.bot_off_reason == SCHEDULE_OFF and not off_now:
            actions.append(Action("on", v.unit.id, v.unit.name, RESUME_SCHEDULE, "OFF 시간대 종료"))
    if off_now:
        for v in on_managed:
            actions.append(Action("off", v.unit.id, v.unit.name, SCHEDULE_OFF,
                                  f"OFF 시간대 ({now.hour}시)"))
        return _finish(site, views, managed, actions, alerts, frozen, defensive, site_lb, today_cost)

    if frozen:
        return _finish(site, views, managed, actions, alerts, frozen, defensive, site_lb, today_cost)

    # ---- 3. leak detection --------------------------------------------------
    threshold = leak_threshold(site, site_lb)
    leaks = []
    for v in on_managed:
        unit_threshold = threshold
        if v.state.off_count > 0:  # re-entry probe: a second chance, but a cheaper one
            unit_threshold = max(site.leak_min_cost, threshold * site.probe_threshold_factor)
        cost = eff_cost(site, v.lookback)
        if v.lookback.conversions == 0:
            if cost >= unit_threshold:
                leaks.append((cost, v, LEAK_NO_CONV,
                              f"{site.lookback_days}일 광고비 {cost:,.0f}원, 전환 0건 (임계 {unit_threshold:,.0f}원)"))
            continue
        # Stop-loss judges only data since the last change, so an already-corrected bid is not punished.
        recent_cost = eff_cost(site, v.recent_stats)
        r = roas_of(site, v.recent_stats)
        if recent_cost >= unit_threshold and r is not None and r < site.stoploss_ratio * target:
            leaks.append((recent_cost, v, ROAS_STOPLOSS,
                          f"ROAS {r:.0%} < 목표 {target:.0%}의 {site.stoploss_ratio:.0%} (광고비 {recent_cost:,.0f}원)"))
    leaks.sort(key=lambda t: t[0], reverse=True)

    base = len(on_managed) + offs_recent
    max_total = max(site.max_off_floor, math.ceil(site.max_off_pct_per_day * base))
    max_offs = max(0, max_total - offs_recent)
    gated = 0
    leak_ids = set()
    for i, (cost, v, code, reason) in enumerate(leaks):
        needs = i >= max_offs
        gated += int(needs)
        leak_ids.add(v.unit.id)
        actions.append(Action("off", v.unit.id, v.unit.name, code, reason, needs_approval=needs))
    if gated:
        alerts.append(Alert(
            "OFF_NEEDS_APPROVAL", "warn",
            f"[{site.key}] 24시간 동안 자동으로 끌 수 있는 한도({max_total}건)를 넘어 {gated}건은 승인 대기입니다."))

    # ---- 4. bid adjustment --------------------------------------------------
    site_rpc = eff_revenue(site, site_lb) / site_lb.clicks if site_lb.clicks > 0 else 0.0
    cooldown = timedelta(hours=site.cooldown_hours)
    for v in on_managed:
        if v.unit.id in leak_ids:
            continue
        last = v.state.last_change_at
        if last is not None and now - last < cooldown:
            continue
        new_bid, code, est = propose_bid(site, v.unit.bid, v.recent_stats, site_rpc)
        if new_bid is None:
            continue
        if defensive and new_bid > v.unit.bid:
            continue
        actions.append(Action(
            "bid", v.unit.id, v.unit.name, code,
            f"추정 ROAS {est:.0%} vs 목표 {target:.0%}", old=v.unit.bid, new=new_bid))

    # ---- 5. re-entry of leak-off units -------------------------------------
    if not defensive:
        candidates = sorted(
            (v for v in managed if not v.unit.on and v.state.bot_off_reason in LEAK_CODES),
            key=lambda v: v.state.bot_off_at or now)
        resumed = 0
        for v in candidates:
            st = v.state
            if st.off_count >= site.max_offs_before_review:
                alerts.append(Alert(
                    f"REVIEW:{v.unit.id}", "warn",
                    f"[{site.key}] '{v.unit.name}'은(는) 누수로 {st.off_count}회 꺼졌습니다. 사람의 검토가 필요합니다."))
                continue
            wait_days = min(site.resume_days * 2 ** max(st.off_count - 1, 0), site.resume_max_days)
            if st.bot_off_at is None or now - st.bot_off_at < timedelta(days=wait_days):
                continue
            if resumed >= site.max_resumes_per_run:
                break
            resumed += 1
            actions.append(Action("on", v.unit.id, v.unit.name, RESUME_PROBE,
                                  f"{wait_days}일 경과: 재진입 테스트 ({st.off_count}회차)", reset_eval=True))

    return _finish(site, views, managed, actions, alerts, frozen, defensive, site_lb, today_cost)


def _finish(site, views, managed, actions, alerts, frozen, defensive, site_lb, today_cost) -> Decision:
    counts: dict = {}
    for a in actions:
        counts[a.code] = counts.get(a.code, 0) + 1
    roas = roas_of(site, site_lb)
    summary = {
        "site": site.key,
        "units": len(views),
        "managed_on": sum(1 for v in managed if v.unit.on),
        "lookback_cost": round(eff_cost(site, site_lb)),
        "lookback_revenue": round(eff_revenue(site, site_lb)),
        "lookback_roas": None if roas is None else round(roas, 4),
        "target_roas": target_ratio(site),
        "today_cost": round(today_cost),
        "daily_budget_cap": site.daily_budget_cap,
        "frozen": frozen,
        "defensive": defensive,
        "actions_by_code": counts,
    }
    return Decision(actions=actions, alerts=alerts, summary=summary)
