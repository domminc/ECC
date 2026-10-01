"""Notifications: stdout + optional log file + Slack / Discord webhooks."""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from typing import Callable, Optional

DISCORD_LIMIT = 1900  # Discord rejects messages over 2000 characters


def _post_json(url: str, payload: dict) -> None:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json; charset=UTF-8", "User-Agent": "naver-ads-autopilot"})
    urllib.request.urlopen(req, timeout=10).read()


def webhook_kind(url: str) -> str:
    host = urllib.parse.urlsplit(url).netloc.lower()
    if host.endswith("discord.com") or host.endswith("discordapp.com"):
        return "discord"
    if host.endswith("slack.com"):
        return "slack"
    return "generic"


def split_for_discord(text: str, limit: int = DISCORD_LIMIT) -> list:
    chunks, current = [], ""
    for line in text.split("\n"):
        while len(line) > limit:  # a single very long line
            if current:
                chunks.append(current)
                current = ""
            chunks.append(line[:limit])
            line = line[limit:]
        if current and len(current) + 1 + len(line) > limit:
            chunks.append(current)
            current = line
        else:
            current = f"{current}\n{line}" if current else line
    if current:
        chunks.append(current)
    return chunks or [""]


def payloads_for(url: str, text: str) -> list:
    kind = webhook_kind(url)
    if kind == "discord":
        return [{"content": chunk} for chunk in split_for_discord(text)]
    if kind == "slack":
        return [{"text": text}]
    return [{"text": text, "content": text[:DISCORD_LIMIT]}]


class Notifier:
    """Warnings and critical alerts go to every webhook; info only when `always_webhook` is set."""

    def __init__(self, webhook_urls: Optional[list] = None, log_path: Optional[str] = None,
                 out: Callable = print, post: Callable = _post_json):
        self.webhook_urls = [u for u in (webhook_urls or []) if u]
        self.log_path = log_path
        self._out = out
        self._post = post
        self.sent: list = []  # kept for tests and the daily digest

    def send(self, level: str, title: str, body: str = "", always_webhook: bool = False) -> None:
        text = f"[{level.upper()}] {title}" + (f"\n{body}" if body else "")
        self.sent.append((level, title, body))
        self._out(text)
        if self.log_path:
            try:
                with open(self.log_path, "a", encoding="utf-8") as fh:
                    fh.write(text + "\n")
            except OSError as err:
                print(f"[Notifier] log write failed: {err}", file=sys.stderr)
        if level in ("warn", "critical") or always_webhook:
            for url in self.webhook_urls:
                for payload in payloads_for(url, text):
                    try:
                        self._post(url, payload)
                    except Exception as err:  # a broken webhook must never stop the run
                        print(f"[Notifier] {webhook_kind(url)} webhook failed: {err}", file=sys.stderr)
                        break
