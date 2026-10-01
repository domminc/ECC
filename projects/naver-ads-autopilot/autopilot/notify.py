"""Notifications: stdout + optional log file + optional webhook (Slack/Discord-compatible)."""

from __future__ import annotations

import json
import sys
import urllib.request
from typing import Callable, Optional


def _post_json(url: str, payload: dict) -> None:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json; charset=UTF-8"})
    urllib.request.urlopen(req, timeout=10).read()


class Notifier:
    def __init__(self, webhook_url: Optional[str] = None, log_path: Optional[str] = None,
                 out: Callable = print, post: Callable = _post_json):
        self.webhook_url = webhook_url
        self.log_path = log_path
        self._out = out
        self._post = post
        self.sent: list = []  # kept for tests and the daily digest

    def send(self, level: str, title: str, body: str = "") -> None:
        text = f"[{level.upper()}] {title}" + (f"\n{body}" if body else "")
        self.sent.append((level, title, body))
        self._out(text)
        if self.log_path:
            try:
                with open(self.log_path, "a", encoding="utf-8") as fh:
                    fh.write(text + "\n")
            except OSError as err:
                print(f"[Notifier] log write failed: {err}", file=sys.stderr)
        if self.webhook_url and level in ("warn", "critical"):
            try:
                self._post(self.webhook_url, {"text": text, "content": text})
            except Exception as err:  # a broken webhook must never stop the run
                print(f"[Notifier] webhook failed: {err}", file=sys.stderr)
