"""One autopilot run for one site: collect -> decide -> guard -> execute -> record -> notify."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

from . import store as st
from .config import SiteConfig
from .engine import decide
from .models import EMPTY_STATS, LEAK_CODES, Action, Decision, UnitState, UnitView
from .naver_client import ApiError, RateLimited
from .notify import Notifier
from .store import Store


@dataclass
class RunResult:
    aborted: Optional[str] = None
    decision: Optional[Decision] = None
    applied: int = 0
    failed: int = 0
    planned: int = 0  # dry-run actions that would have been applied
    pending: int = 0  # waiting for human approval
    notes: list = field(default_factory=list)


def _apply(client, units_by_id: dict, action: Action) -> None:
    if action.kind == "campaign_budget":
        client.set_campaign_budget(action.unit_id, int(action.new))
        return
    unit = units_by_id[action.unit_id]
    if action.kind == "off":
        client.set_unit_on(unit, False)
    elif action.kind == "on":
        client.set_unit_on(unit, True)
    elif action.kind == "bid":
        client.set_bid(unit, int(action.new))
    else:
        raise ValueError(f"unknown action kind {action.kind!r}")


def _update_state(state: UnitState, action: Action, now: datetime) -> None:
    if action.kind == "campaign_budget":
        return
    state.last_change_at = now
    if action.kind == "off":
        state.bot_off_reason = action.code
        state.bot_off_at = now
        if action.code in LEAK_CODES:
            state.off_count += 1
    elif action.kind == "on":
        state.bot_off_reason = None
        state.bot_off_at = None
        if action.reset_eval:
            state.eval_since = now.date()


def build_views(site: SiteConfig, client, units: list, states: dict, now: datetime) -> list:
    today = now.date()
    until = today - timedelta(days=1)  # today's partial, conversion-lagged data is not evidence
    base_since = today - timedelta(days=site.lookback_days)

    # Two windows per unit: the full lookback (leak detection) and the data since the unit's
    # last change (bid judgement). Stats are daily, so the change day itself is excluded.
    since_by_unit: dict = {}
    wanted: dict = {}
    for unit in units:
        state = states.get(unit.id) or UnitState()
        lookback_since = max(base_since, state.eval_since) if state.eval_since else base_since
        recent_since = lookback_since
        if state.last_change_at:
            recent_since = max(lookback_since, state.last_change_at.date() + timedelta(days=1))
        since_by_unit[unit.id] = (lookback_since, recent_since)
        wanted.setdefault(lookback_since, set()).add(unit.id)
        wanted.setdefault(recent_since, set()).add(unit.id)

    fetched: dict = {}
    for since, ids in wanted.items():
        if since > until:
            fetched[since] = {i: EMPTY_STATS for i in ids}
        else:
            fetched[since] = client.get_stats(sorted(ids), since, until)
    today_stats = client.get_stats([u.id for u in units], today, today) if units else {}

    views = []
    for unit in units:
        lookback_since, recent_since = since_by_unit[unit.id]
        views.append(UnitView(
            unit=unit,
            lookback=fetched[lookback_since].get(unit.id, EMPTY_STATS),
            recent=fetched[recent_since].get(unit.id, EMPTY_STATS),
            today=today_stats.get(unit.id, EMPTY_STATS),
            state=states.get(unit.id, UnitState())))
    return views


def _mirror(unit, action: Action) -> None:
    """Keep the in-memory unit consistent with what we just wrote to the API."""
    if action.kind == "off":
        unit.on = False
    elif action.kind == "on":
        unit.on = True
    elif action.kind == "bid":
        unit.bid = int(action.new)


def _approved_still_valid(units_by_id: dict, action: Action) -> bool:
    if action.kind == "campaign_budget":
        return True
    unit = units_by_id.get(action.unit_id)
    if unit is None:
        return False
    if action.kind == "off":
        return unit.on
    if action.kind == "on":
        return not unit.on
    return True


def run_site(site: SiteConfig, client, store: Store, notifier: Notifier, now: datetime, *,
             dry_run: bool = True, kill_switch_file: Optional[str] = None) -> RunResult:
    result = RunResult()
    day = now.date().isoformat()

    def alert(key: str, level: str, message: str) -> None:
        if store.try_alert(site.key, key, day, level, message):
            notifier.send(level, f"{site.key}: {key}", message)

    if kill_switch_file and os.path.exists(kill_switch_file):
        result.aborted = "KILL_SWITCH"
        alert("KILL_SWITCH", "warn", f"킬스위치 파일({kill_switch_file})이 있어 실행하지 않습니다.")
        return result

    run_id = store.start_run(site.key, now, dry_run)

    def finish(extra: dict) -> RunResult:
        store.finish_run(run_id, {**extra, "dry_run": dry_run, "applied": result.applied,
                                  "failed": result.failed, "planned": result.planned,
                                  "pending": result.pending, "aborted": result.aborted})
        return result

    def commit(action: Action, units_by_id: dict, states: dict) -> None:
        _apply(client, units_by_id, action)
        if action.kind != "campaign_budget":
            unit = units_by_id[action.unit_id]
            _mirror(unit, action)
            _update_state(states[unit.id], action, now)
            store.save_state(site.key, unit.id, states[unit.id])

    try:
        units = client.list_units()
        units_by_id = {u.id: u for u in units}
        states = store.load_states(site.key)
        states = {u.id: states.get(u.id, UnitState()) for u in units}

        # A human turned a bot-disabled unit back on: forget our claim on it.
        for unit in units:
            state = states[unit.id]
            if unit.on and state.bot_off_reason:
                state.bot_off_reason = None
                state.bot_off_at = None
                store.save_state(site.key, unit.id, state)

        # Actions a human approved since the last run are executed first and re-validated
        # against the current state, so the new decision below already sees their effect.
        if not dry_run:
            for row in store.approved_actions(site.key):
                action = Store.row_to_action(row)
                if not _approved_still_valid(units_by_id, action):
                    store.set_status(row["id"], st.EXPIRED, "상태가 바뀌어 만료")
                    continue
                try:
                    commit(action, units_by_id, states)
                except RateLimited:
                    raise
                except (ApiError, KeyError, ValueError) as err:
                    store.set_status(row["id"], st.FAILED, str(err))
                    result.failed += 1
                    continue
                store.set_status(row["id"], st.APPLIED)
                result.applied += 1

        views = build_views(site, client, units, states, now)
        offs_recent = store.count_applied(site.key, "off", LEAK_CODES, now - timedelta(hours=24))
        decision = decide(site, views, now, offs_recent=offs_recent)
    except RateLimited as err:
        result.aborted = "RATE_LIMITED"
        alert("RATE_LIMITED", "critical", f"API 속도 제한이 계속되어 실행을 중단했습니다: {err}")
        return finish({})
    except Exception as err:  # never act on partial data
        result.aborted = "COLLECT_FAILED"
        alert("COLLECT_FAILED", "critical", f"데이터 수집 실패로 실행을 중단했습니다: {err}")
        return finish({})

    result.decision = decision
    for a in decision.alerts:
        alert(a.key, a.level, a.message)

    auto = [a for a in decision.actions if not a.needs_approval]
    if len(auto) > site.max_actions_per_run:
        result.aborted = "ACTION_FLOOD"
        alert("ACTION_FLOOD", "critical",
              f"한 번에 {len(auto)}건의 변경이 계획되어(한도 {site.max_actions_per_run}) 아무것도 실행하지 않았습니다.")
        return finish(decision.summary)

    try:
        for action in decision.actions:
            # A human said "keep it": do not propose (or auto-apply) the same thing again for a week.
            if store.recently_rejected(site.key, action.unit_id, action.code,
                                       now - timedelta(days=site.resume_days)):
                continue
            if action.needs_approval:
                if not store.has_pending(site.key, action.unit_id, action.code):
                    store.record_action(run_id, site.key, now, action, st.PENDING)
                result.pending += 1
            elif dry_run:
                store.record_action(run_id, site.key, now, action, st.DRY_RUN)
                result.planned += 1
            else:
                try:
                    commit(action, units_by_id, states)
                except RateLimited as err:
                    store.record_action(run_id, site.key, now, action, st.FAILED, str(err))
                    result.failed += 1
                    raise
                except (ApiError, KeyError, ValueError) as err:
                    store.record_action(run_id, site.key, now, action, st.FAILED, str(err))
                    result.failed += 1
                    continue
                store.record_action(run_id, site.key, now, action, st.APPLIED)
                result.applied += 1
    except RateLimited as err:
        result.aborted = "RATE_LIMITED"
        alert("RATE_LIMITED", "critical", f"API 속도 제한이 계속되어 실행을 중단했습니다: {err}")

    return finish(decision.summary)
