"""Command line entry point:  python -m autopilot <command> --help"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

from .config import Config, ConfigError, SiteConfig, load_config
from .naver_client import ApiError, NaverSearchAdClient
from .notify import Notifier
from .report import build_digest, format_text, render_html
from .runner import run_site
from .simulator import compare, format_comparison
from .store import Store


def _local_now(cfg: Config) -> datetime:
    utc = datetime.now(timezone.utc)
    return (utc + timedelta(hours=cfg.global_.utc_offset_hours)).replace(tzinfo=None, microsecond=0)


def _client_for(cfg: Config, site: SiteConfig) -> NaverSearchAdClient:
    missing = [n for n in (site.api_key_env, site.secret_env, site.customer_id_env) if not os.environ.get(n or "")]
    if missing:
        raise ConfigError(f"sites.{site.key}: 환경변수가 비어 있습니다: {missing}")
    return NaverSearchAdClient(
        os.environ[site.api_key_env], os.environ[site.secret_env], os.environ[site.customer_id_env],
        level=site.level, campaign_types=site.campaign_types, ad_types=site.ad_types,
        stat_fields={"conversions": site.stat_conversions_field, "revenue": site.stat_revenue_field},
        min_interval=cfg.global_.request_min_interval)


def _notifier(cfg: Config, log_path=None) -> Notifier:
    urls = [os.environ.get(name, "") for name in cfg.global_.webhook_url_envs]
    return Notifier(webhook_urls=urls, log_path=log_path)


def _effective_cap(cfg: Config, store: Store, site: SiteConfig, now: datetime):
    """What is left of the all-sites daily cap, based on the other sites' latest runs today."""
    total = cfg.global_.total_daily_cap
    if total is None:
        return None
    day = now.date().isoformat()
    others = sum(store.latest_today_cost(k, day) for k in cfg.sites if k != site.key)
    return max(1, total - others)


def _select(cfg: Config, key):
    if key:
        if key not in cfg.sites:
            raise ConfigError(f"unknown site {key!r}; available: {sorted(cfg.sites)}")
        return [cfg.sites[key]]
    return list(cfg.sites.values())


def cmd_probe(args, cfg: Config) -> int:
    for site in _select(cfg, args.site):
        client = _client_for(cfg, site)
        out = client.probe(_local_now(cfg).date())
        print(json.dumps({"site": site.key, **out}, ensure_ascii=False, indent=2))
    return 0


def cmd_run(args, cfg: Config) -> int:
    store = Store(cfg.global_.db_path)
    notifier = _notifier(cfg, args.log)
    dry_run = not args.live
    print(f"[autopilot] mode={'LIVE' if args.live else 'DRY-RUN (변경 없음)'}")
    code = 0
    for site in _select(cfg, args.site):
        try:
            client = _client_for(cfg, site)
        except ConfigError as err:
            print(f"[autopilot] {err}", file=sys.stderr)
            code = 2
            continue
        now = _local_now(cfg)
        result = run_site(site, client, store, notifier, now, dry_run=dry_run,
                          kill_switch_file=cfg.global_.kill_switch_file,
                          daily_cap=_effective_cap(cfg, store, site, now))
        print(f"[{site.key}] aborted={result.aborted} applied={result.applied} planned={result.planned} "
              f"pending={result.pending} failed={result.failed}")
        if result.aborted:
            code = 1
    return code


def cmd_simulate(args, cfg) -> int:
    print(format_comparison(compare(days=args.days, seed=args.seed, n_units=args.units)))
    return 0


def cmd_report(args, cfg: Config) -> int:
    store = Store(cfg.global_.db_path)
    digest = build_digest(store, list(cfg.sites), _local_now(cfg))
    text = format_text(digest)
    print(text)
    if args.send:
        notifier = _notifier(cfg)
        if not notifier.webhook_urls:
            print("[autopilot] 웹훅 환경변수가 비어 있어 전송하지 않았습니다.", file=sys.stderr)
            return 2
        notifier.send("info", "광고 오토파일럿 일일 요약", text, always_webhook=True)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(render_html(digest))
        print(f"HTML 리포트: {args.out}")
    return 0


def cmd_approvals(args, cfg: Config) -> int:
    store = Store(cfg.global_.db_path)
    if args.approve or args.reject:
        action_id = args.approve or args.reject
        ok = store.decide_pending(action_id, approve=bool(args.approve), at=_local_now(cfg))
        print(("승인" if args.approve else "거절") + (f" 처리: #{action_id}" if ok else f" 실패(대기 중이 아님): #{action_id}"))
        return 0 if ok else 1
    rows = store.list_pending(args.site)
    if not rows:
        print("승인 대기 건이 없습니다.")
    for r in rows:
        print(f"#{r['id']} [{r['site']}] {r['kind'].upper()} {r['unit_name'] or r['unit_id']} · {r['code']} · {r['reason']}")
    return 0


def cmd_kill(args, cfg: Config) -> int:
    path = cfg.global_.kill_switch_file
    if args.resume:
        if os.path.exists(path):
            os.remove(path)
        print(f"킬스위치 해제: {path}")
    else:
        open(path, "a").close()
        print(f"킬스위치 ON: {path}  (모든 run이 쓰기 없이 중단됩니다)")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="autopilot", description="네이버 쇼핑검색광고 오토파일럿")
    sub = p.add_subparsers(dest="command", required=True)

    def add(name, fn, help_, config=True):
        sp = sub.add_parser(name, help=help_)
        if config:
            sp.add_argument("--config", default="config.toml")
        sp.set_defaults(fn=fn)
        return sp

    sp = add("probe", cmd_probe, "실계정 API 응답 모양 확인 (읽기 전용)")
    sp.add_argument("--site")
    sp = add("run", cmd_run, "1회 실행. 기본은 dry-run, --live 일 때만 실제 변경")
    sp.add_argument("--site")
    sp.add_argument("--live", action="store_true")
    sp.add_argument("--log", help="알림 로그 파일")
    sp = add("simulate", cmd_simulate, "가상 시장 시뮬레이션 (네트워크 불필요)", config=False)
    sp.add_argument("--days", type=int, default=45)
    sp.add_argument("--seed", type=int, default=7)
    sp.add_argument("--units", type=int, default=40)
    sp = add("report", cmd_report, "일일 요약 출력 (+ HTML 저장)")
    sp.add_argument("--out", help="HTML 파일 경로")
    sp.add_argument("--send", action="store_true", help="Slack/Discord 웹훅으로 전송")
    sp = add("approvals", cmd_approvals, "승인 대기 목록 / 승인 / 거절")
    sp.add_argument("--site")
    sp.add_argument("--approve", type=int)
    sp.add_argument("--reject", type=int)
    sp = add("kill", cmd_kill, "킬스위치 켜기/끄기")
    sp.add_argument("--resume", action="store_true", help="킬스위치 해제")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        cfg = load_config(args.config) if hasattr(args, "config") else None
        return args.fn(args, cfg)
    except (ConfigError, FileNotFoundError) as err:
        print(f"[autopilot] 설정 오류: {err}", file=sys.stderr)
        return 2
    except ApiError as err:
        print(f"[autopilot] API 오류: {err}", file=sys.stderr)
        return 1
