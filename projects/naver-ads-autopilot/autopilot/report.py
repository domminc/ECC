"""Daily digest: the 2-minute read that replaces watching the ad console."""

from __future__ import annotations

import html
import json
from datetime import datetime, timedelta

from .store import Store

SIGNAL_LABEL = {"ok": "정상", "warn": "주의", "critical": "긴급"}


def build_digest(store: Store, site_keys: list, now: datetime) -> dict:
    since = now - timedelta(hours=24)
    day = now.date().isoformat()
    alerts = [dict(r) for r in store.alerts_for_day(day)]
    sites = []
    for key in site_keys:
        run = store.latest_run(key)
        summary = json.loads(run["summary"]) if run and run["summary"] else {}
        counts: dict = {}
        for row in store.actions_since(key, since):
            counts[(row["code"], row["status"])] = counts.get((row["code"], row["status"]), 0) + 1
        pending = [dict(r) for r in store.list_pending(key)]
        site_alerts = [a for a in alerts if a["site"] == key]
        signal = "ok"
        if pending or summary.get("defensive") or any(a["level"] == "warn" for a in site_alerts):
            signal = "warn"
        if summary.get("frozen") or summary.get("aborted") or any(a["level"] == "critical" for a in site_alerts):
            signal = "critical"
        sites.append({
            "site": key, "signal": signal, "summary": summary, "last_run": run["ts"] if run else None,
            "actions": [{"code": c, "status": s, "count": n} for (c, s), n in sorted(counts.items())],
            "pending": pending, "alerts": site_alerts,
        })
    return {"generated_at": now.isoformat(timespec="minutes"), "sites": sites}


def _pct(v) -> str:
    return "-" if v is None else f"{v:.0%}"


def format_text(digest: dict) -> str:
    lines = [f"광고 오토파일럿 일일 요약  ({digest['generated_at']})", ""]
    for s in digest["sites"]:
        m = s["summary"]
        lines.append(f"■ {s['site']}  [{SIGNAL_LABEL[s['signal']]}]  마지막 실행: {s['last_run'] or '없음'}")
        if m:
            lines.append(
                f"  최근 {m.get('lookback_cost', 0):,}원 → 매출 {m.get('lookback_revenue', 0):,}원 · "
                f"ROAS {_pct(m.get('lookback_roas'))} (목표 {_pct(m.get('target_roas'))}) · "
                f"오늘 {m.get('today_cost', 0):,}/{m.get('daily_budget_cap', 0):,}원")
        for a in s["actions"]:
            lines.append(f"  - {a['code']} ({a['status']}): {a['count']}건")
        if s["pending"]:
            lines.append(f"  승인 대기 {len(s['pending'])}건 → `approvals --list`")
        for al in s["alerts"]:
            lines.append(f"  ! [{al['level']}] {al['message']}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_html(digest: dict) -> str:
    esc = html.escape
    colors = {"ok": "#0E9F6E", "warn": "#B45309", "critical": "#B91C1C"}
    cards = []
    for s in digest["sites"]:
        m = s["summary"]
        rows = "".join(
            f"<tr><td>{esc(a['code'])}</td><td>{esc(a['status'])}</td><td>{a['count']}</td></tr>"
            for a in s["actions"]) or "<tr><td colspan=3>최근 24시간 변경 없음</td></tr>"
        alerts = "".join(f"<li>[{esc(a['level'])}] {esc(a['message'])}</li>" for a in s["alerts"])
        pending = "".join(
            f"<li>#{p['id']} {esc(p['kind'])} {esc(p['unit_name'] or p['unit_id'])} · {esc(p['reason'] or '')}</li>"
            for p in s["pending"])
        cards.append(f"""
<section>
  <h2><span class="dot" style="background:{colors[s['signal']]}"></span>{esc(s['site'])}
      <small>{SIGNAL_LABEL[s['signal']]} · 마지막 실행 {esc(str(s['last_run'] or '없음'))}</small></h2>
  <p>최근 광고비 <b>{m.get('lookback_cost', 0):,}원</b> · 전환매출 <b>{m.get('lookback_revenue', 0):,}원</b> ·
     ROAS <b>{_pct(m.get('lookback_roas'))}</b> (목표 {_pct(m.get('target_roas'))}) ·
     오늘 {m.get('today_cost', 0):,} / {m.get('daily_budget_cap', 0):,}원</p>
  <table><thead><tr><th>사유 코드</th><th>상태</th><th>건수</th></tr></thead><tbody>{rows}</tbody></table>
  {'<h3>승인 대기</h3><ul>' + pending + '</ul>' if pending else ''}
  {'<h3>알림</h3><ul>' + alerts + '</ul>' if alerts else ''}
</section>""")
    return f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>광고 오토파일럿 일일 요약</title>
<style>
body{{font-family:Pretendard,system-ui,sans-serif;background:#F8FAFC;color:#0F172A;margin:0;padding:24px}}
main{{max-width:880px;margin:0 auto}} h1{{font-size:24px}}
section{{background:#fff;border:1px solid #E2E8F0;border-radius:16px;padding:20px;margin:16px 0}}
h2{{font-size:20px;margin:0 0 8px}} h2 small{{font-weight:400;color:#64748B;font-size:14px;margin-left:8px}}
.dot{{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px}}
table{{border-collapse:collapse;width:100%;font-size:14px}} th,td{{text-align:left;padding:8px;border-bottom:1px solid #E2E8F0}}
</style></head><body><main>
<h1>광고 오토파일럿 일일 요약</h1><p>{esc(digest['generated_at'])} 기준</p>
{''.join(cards)}
</main></body></html>
"""
