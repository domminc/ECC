"""SQLite persistence: runs, audit log, per-unit state, alerts, approvals."""

from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime
from typing import Optional

from .models import Action, UnitState

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL, ts TEXT NOT NULL, dry_run INTEGER NOT NULL,
  summary TEXT
);
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER, site TEXT NOT NULL, ts TEXT NOT NULL,
  unit_id TEXT NOT NULL, unit_name TEXT, kind TEXT NOT NULL, code TEXT NOT NULL,
  reason TEXT, old REAL, new REAL,
  status TEXT NOT NULL, reset_eval INTEGER DEFAULT 0, error TEXT, decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_actions_site_ts ON actions(site, ts);
CREATE TABLE IF NOT EXISTS unit_state (
  site TEXT NOT NULL, unit_id TEXT NOT NULL,
  last_change_at TEXT, bot_off_reason TEXT, bot_off_at TEXT,
  off_count INTEGER NOT NULL DEFAULT 0, eval_since TEXT,
  PRIMARY KEY (site, unit_id)
);
CREATE TABLE IF NOT EXISTS alerts (
  site TEXT NOT NULL, key TEXT NOT NULL, day TEXT NOT NULL,
  level TEXT NOT NULL, message TEXT NOT NULL,
  PRIMARY KEY (site, key, day)
);
"""

APPLIED = "applied"
DRY_RUN = "dry_run"
FAILED = "failed"
PENDING = "pending_approval"
APPROVED = "approved"
REJECTED = "rejected"
EXPIRED = "expired"


def _dt(value: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(value) if value else None


class Store:
    def __init__(self, path: str = ":memory:"):
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # ---- runs
    def start_run(self, site: str, ts: datetime, dry_run: bool) -> int:
        cur = self.conn.execute(
            "INSERT INTO runs (site, ts, dry_run) VALUES (?, ?, ?)", (site, ts.isoformat(), int(dry_run)))
        self.conn.commit()
        return cur.lastrowid

    def finish_run(self, run_id: int, summary: dict) -> None:
        self.conn.execute("UPDATE runs SET summary = ? WHERE id = ?", (json.dumps(summary, ensure_ascii=False), run_id))
        self.conn.commit()

    def latest_run(self, site: str):
        row = self.conn.execute(
            "SELECT * FROM runs WHERE site = ? ORDER BY id DESC LIMIT 1", (site,)).fetchone()
        return row

    # ---- actions / audit log
    def record_action(self, run_id: int, site: str, ts: datetime, a: Action, status: str,
                      error: Optional[str] = None) -> int:
        cur = self.conn.execute(
            "INSERT INTO actions (run_id, site, ts, unit_id, unit_name, kind, code, reason, old, new,"
            " status, reset_eval, error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (run_id, site, ts.isoformat(), a.unit_id, a.unit_name, a.kind, a.code, a.reason,
             a.old, a.new, status, int(a.reset_eval), error))
        self.conn.commit()
        return cur.lastrowid

    def has_pending(self, site: str, unit_id: str, code: str) -> bool:
        row = self.conn.execute(
            "SELECT 1 FROM actions WHERE site=? AND unit_id=? AND code=? AND status IN (?, ?) LIMIT 1",
            (site, unit_id, code, PENDING, APPROVED)).fetchone()
        return row is not None

    def count_applied(self, site: str, kind: str, codes: tuple, since: datetime) -> int:
        marks = ",".join("?" * len(codes))
        row = self.conn.execute(
            f"SELECT COUNT(*) FROM actions WHERE site=? AND kind=? AND status=? AND ts >= ? AND code IN ({marks})",
            (site, kind, APPLIED, since.isoformat(), *codes)).fetchone()
        return row[0]

    def actions_since(self, site: str, since: datetime):
        return self.conn.execute(
            "SELECT * FROM actions WHERE site=? AND ts >= ? ORDER BY id", (site, since.isoformat())).fetchall()

    def list_pending(self, site: Optional[str] = None):
        sql = "SELECT * FROM actions WHERE status = ?"
        args: list = [PENDING]
        if site:
            sql += " AND site = ?"
            args.append(site)
        return self.conn.execute(sql + " ORDER BY id", args).fetchall()

    def approved_actions(self, site: str):
        return self.conn.execute(
            "SELECT * FROM actions WHERE site = ? AND status = ? ORDER BY id", (site, APPROVED)).fetchall()

    def set_status(self, action_id: int, status: str, error: Optional[str] = None) -> bool:
        cur = self.conn.execute("UPDATE actions SET status = ?, error = ? WHERE id = ?",
                                (status, error, action_id))
        self.conn.commit()
        return cur.rowcount > 0

    def decide_pending(self, action_id: int, approve: bool, at: Optional[datetime] = None) -> bool:
        cur = self.conn.execute(
            "UPDATE actions SET status = ?, decided_at = ? WHERE id = ? AND status = ?",
            (APPROVED if approve else REJECTED, (at or datetime.now()).isoformat(), action_id, PENDING))
        self.conn.commit()
        return cur.rowcount > 0

    def recently_rejected(self, site: str, unit_id: str, code: str, since: datetime) -> bool:
        row = self.conn.execute(
            "SELECT 1 FROM actions WHERE site=? AND unit_id=? AND code=? AND status=? AND decided_at >= ? LIMIT 1",
            (site, unit_id, code, REJECTED, since.isoformat())).fetchone()
        return row is not None

    @staticmethod
    def row_to_action(row) -> Action:
        return Action(kind=row["kind"], unit_id=row["unit_id"], unit_name=row["unit_name"] or "",
                      code=row["code"], reason=row["reason"] or "", old=row["old"], new=row["new"],
                      reset_eval=bool(row["reset_eval"]))

    # ---- unit state
    def load_states(self, site: str) -> dict:
        out = {}
        for r in self.conn.execute("SELECT * FROM unit_state WHERE site = ?", (site,)):
            out[r["unit_id"]] = UnitState(
                last_change_at=_dt(r["last_change_at"]),
                bot_off_reason=r["bot_off_reason"],
                bot_off_at=_dt(r["bot_off_at"]),
                off_count=r["off_count"],
                eval_since=date.fromisoformat(r["eval_since"]) if r["eval_since"] else None)
        return out

    def save_state(self, site: str, unit_id: str, st: UnitState) -> None:
        self.conn.execute(
            "INSERT INTO unit_state (site, unit_id, last_change_at, bot_off_reason, bot_off_at, off_count, eval_since)"
            " VALUES (?,?,?,?,?,?,?) ON CONFLICT(site, unit_id) DO UPDATE SET"
            " last_change_at=excluded.last_change_at, bot_off_reason=excluded.bot_off_reason,"
            " bot_off_at=excluded.bot_off_at, off_count=excluded.off_count, eval_since=excluded.eval_since",
            (site, unit_id,
             st.last_change_at.isoformat() if st.last_change_at else None,
             st.bot_off_reason,
             st.bot_off_at.isoformat() if st.bot_off_at else None,
             st.off_count,
             st.eval_since.isoformat() if st.eval_since else None))
        self.conn.commit()

    # ---- alerts (de-duplicated per site/key/day)
    def try_alert(self, site: str, key: str, day: str, level: str, message: str) -> bool:
        cur = self.conn.execute(
            "INSERT OR IGNORE INTO alerts (site, key, day, level, message) VALUES (?,?,?,?,?)",
            (site, key, day, level, message))
        self.conn.commit()
        return cur.rowcount > 0

    def alerts_for_day(self, day: str):
        return self.conn.execute("SELECT * FROM alerts WHERE day = ? ORDER BY site, level", (day,)).fetchall()
