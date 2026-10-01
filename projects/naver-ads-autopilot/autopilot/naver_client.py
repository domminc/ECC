"""Naver Search Ad API client (stdlib only).

Verified against the official sample and Swagger spec (naver/searchad-apidoc):
  * signature = Base64(HMAC-SHA256(secret, "{timestamp}.{METHOD}.{path}"))
  * GET /ncc/campaigns, /ncc/adgroups, /ncc/keywords, /ncc/ads, GET /stats call shape
  * PUT /ncc/adgroups/{id}?fields=userLock|bidAmt|budget, PUT /ncc/keywords?fields=...
  * PUT /ncc/ads/{id}?fields=userLock, PUT /ncc/campaigns/{id}?fields=budget
  * /stats salesAmt is VAT-inclusive; purchase conversions are purchaseCcnt / purchaseConvAmt
  * error code 1016 = too many connections (treated like HTTP 429)

NOT verifiable without a live account (run `probe` first): the exact shape of a
shopping ad's `adAttr` (bid information) and whether the purchase fields are
accepted by /stats for multiple ids. Both are isolated in small helpers below.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from typing import Callable, Optional

from .models import Stats, Unit

BASE_URL = "https://api.searchad.naver.com"

DEFAULT_STAT_FIELDS = {
    "impressions": "impCnt",
    "clicks": "clkCnt",
    "cost": "salesAmt",  # VAT included
    "conversions": "purchaseCcnt",
    "revenue": "purchaseConvAmt",
}

# Candidates `probe` tries one by one when a combined /stats request is rejected.
PROBE_STAT_FIELDS = ["impCnt", "clkCnt", "salesAmt", "ccnt", "convAmt", "purchaseCcnt", "purchaseConvAmt",
                     "purchaseRor"]


class ApiError(RuntimeError):
    def __init__(self, status: int, payload, uri: str):
        super().__init__(f"HTTP {status} on {uri}: {str(payload)[:300]}")
        self.status = status
        self.payload = payload
        self.uri = uri


class RateLimited(ApiError):
    """Raised after the retry budget for 429 / error code 1016 is exhausted."""


def sign(secret: str, timestamp: str, method: str, uri: str) -> str:
    message = f"{timestamp}.{method}.{uri}".encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def urllib_transport(method: str, url: str, headers: dict, body):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status, raw = resp.status, resp.read()
    except urllib.error.HTTPError as err:
        status, raw = err.code, err.read()
    text = raw.decode("utf-8", "replace")
    try:
        return status, json.loads(text) if text else None
    except ValueError:
        return status, text


def _is_rate_limited(status: int, payload) -> bool:
    return status == 429 or (isinstance(payload, dict) and payload.get("code") == 1016)


def _adattr(ad: dict):
    """Return (attr_dict, was_json_string). The spec types adAttr as a string in responses."""
    raw = ad.get("adAttr")
    if isinstance(raw, str):
        try:
            return json.loads(raw), True
        except ValueError:
            return {}, True
    return (raw if isinstance(raw, dict) else {}), False


def _ad_name(ad: dict, group_name: str) -> str:
    creative = ad.get("ad")
    if isinstance(creative, str):
        try:
            creative = json.loads(creative)
        except ValueError:
            creative = None
    if isinstance(creative, dict):
        for key in ("productName", "name", "title", "headline"):
            if creative.get(key):
                return str(creative[key])
    return f"{group_name} / {ad['nccAdId']}"


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


class NaverSearchAdClient:
    def __init__(self, api_key: str, secret: str, customer_id: str, *, level: str = "adgroup",
                 campaign_types=("SHOPPING",), ad_types=("SHOPPING_PRODUCT_AD",),
                 stat_fields: Optional[dict] = None, stat_chunk: int = 50,
                 transport: Callable = urllib_transport, sleep: Callable = time.sleep,
                 clock: Callable = time.time, min_interval: float = 0.25, max_retries: int = 5,
                 backoff_base: float = 2.0):
        self.api_key = api_key
        self.secret = secret
        self.customer_id = str(customer_id)
        self.level = level
        self.campaign_types = tuple(campaign_types or ())
        self.ad_types = tuple(ad_types or ())
        self.stat_fields = {**DEFAULT_STAT_FIELDS, **(stat_fields or {})}
        self.stat_chunk = stat_chunk
        self._transport = transport
        self._sleep = sleep
        self._clock = clock
        self.min_interval = min_interval
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self._last_request = 0.0

    # ---- low level
    def _throttle(self) -> None:
        wait = self._last_request + self.min_interval - self._clock()
        if wait > 0:
            self._sleep(wait)
        self._last_request = self._clock()

    def _request(self, method: str, uri: str, params: Optional[dict] = None, body=None):
        attempt = 0
        while True:
            self._throttle()
            timestamp = str(round(self._clock() * 1000))
            headers = {
                "Content-Type": "application/json; charset=UTF-8",
                "X-Timestamp": timestamp,
                "X-API-KEY": self.api_key,
                "X-Customer": self.customer_id,
                "X-Signature": sign(self.secret, timestamp, method, uri),  # path only, no query string
            }
            url = BASE_URL + uri + (("?" + urllib.parse.urlencode(params, doseq=True)) if params else "")
            status, payload = self._transport(method, url, headers, body)
            if _is_rate_limited(status, payload) or status >= 500:
                attempt += 1
                if attempt > self.max_retries:
                    cls = RateLimited if _is_rate_limited(status, payload) else ApiError
                    raise cls(status, payload, uri)
                self._sleep(self.backoff_base ** attempt + random.uniform(0, 1))
                continue
            if status >= 400:
                raise ApiError(status, payload, uri)
            return payload

    # ---- reads
    def list_units(self) -> list:
        units = []
        for camp in self._request("GET", "/ncc/campaigns") or []:
            if camp.get("delFlag"):
                continue
            if self.campaign_types and camp.get("campaignTp") not in self.campaign_types:
                continue
            cid = camp["nccCampaignId"]
            camp_on = not camp.get("userLock")
            budget = camp.get("dailyBudget") if camp.get("useDailyBudget") else None
            groups = self._request("GET", "/ncc/adgroups", params={"nccCampaignId": cid}) or []
            for grp in groups:
                if grp.get("delFlag"):
                    continue
                gid = grp["nccAdgroupId"]
                grp_on = not grp.get("userLock")
                if self.level == "ad":
                    for ad in self._request("GET", "/ncc/ads", params={"nccAdgroupId": gid}) or []:
                        if ad.get("delFlag") or ad.get("status") == "DELETED":
                            continue
                        if self.ad_types and ad.get("type") not in self.ad_types:
                            continue
                        attr, _ = _adattr(ad)
                        uses_group = bool(attr.get("useGroupBidAmt"))
                        bid = int(grp.get("bidAmt") or 0) if uses_group else int(attr.get("bidAmt") or 0)
                        units.append(Unit(
                            id=ad["nccAdId"], name=_ad_name(ad, grp.get("name", gid)), level="ad",
                            campaign_id=cid, on=not ad.get("userLock"), bid=bid, parent_on=camp_on and grp_on,
                            uses_group_bid=uses_group, campaign_daily_budget=budget, adgroup_id=gid))
                    continue
                if self.level == "adgroup":
                    units.append(Unit(
                        id=gid, name=grp.get("name", gid), level="adgroup", campaign_id=cid,
                        on=grp_on, bid=int(grp.get("bidAmt") or 0), parent_on=camp_on,
                        campaign_daily_budget=budget, adgroup_id=gid))
                    continue
                for kw in self._request("GET", "/ncc/keywords", params={"nccAdgroupId": gid}) or []:
                    if kw.get("delFlag"):
                        continue
                    uses_group = bool(kw.get("useGroupBidAmt"))
                    bid = int(grp.get("bidAmt") or 0) if uses_group else int(kw.get("bidAmt") or 0)
                    units.append(Unit(
                        id=kw["nccKeywordId"], name=kw.get("keyword", kw["nccKeywordId"]), level="keyword",
                        campaign_id=cid, on=not kw.get("userLock"), bid=bid, parent_on=camp_on and grp_on,
                        uses_group_bid=uses_group, campaign_daily_budget=budget, adgroup_id=gid))
        return units

    def get_stats(self, ids: list, since: date, until: date) -> dict:
        out: dict = {}
        fields = list(self.stat_fields.values())
        for chunk in _chunks(list(ids), self.stat_chunk):
            payload = self._request("GET", "/stats", params={
                "ids": chunk,
                "fields": json.dumps(fields),
                "timeRange": json.dumps({"since": since.isoformat(), "until": until.isoformat()}),
            })
            rows = payload.get("data", []) if isinstance(payload, dict) else (payload or [])
            for row in rows:
                f = self.stat_fields
                out[row["id"]] = Stats(
                    impressions=int(row.get(f["impressions"]) or 0),
                    clicks=int(row.get(f["clicks"]) or 0),
                    cost=float(row.get(f["cost"]) or 0),
                    conversions=float(row.get(f["conversions"]) or 0),
                    revenue=float(row.get(f["revenue"]) or 0))
        for unit_id in ids:
            out.setdefault(unit_id, Stats())
        return out

    # ---- writes
    @staticmethod
    def _flag(current, locked: bool):
        """Mirror the JSON type the API returned (bool or 0/1)."""
        return locked if isinstance(current, bool) else int(locked)

    def set_unit_on(self, unit: Unit, on: bool) -> None:
        if unit.level == "ad":
            obj = self._request("GET", f"/ncc/ads/{unit.id}")
            obj["userLock"] = self._flag(obj.get("userLock"), not on)
            self._request("PUT", f"/ncc/ads/{unit.id}", params={"fields": "userLock"}, body=obj)
        elif unit.level == "adgroup":
            obj = self._request("GET", f"/ncc/adgroups/{unit.id}")
            obj["userLock"] = self._flag(obj.get("userLock"), not on)
            self._request("PUT", f"/ncc/adgroups/{unit.id}", params={"fields": "userLock"}, body=obj)
        else:
            obj = self._request("GET", f"/ncc/keywords/{unit.id}")
            obj["userLock"] = self._flag(obj.get("userLock"), not on)
            self._request("PUT", "/ncc/keywords", params={"fields": "userLock"}, body=[obj])

    def set_bid(self, unit: Unit, bid: int) -> None:
        if unit.level == "ad":
            # The spec lists only userLock/inspect as `fields` for ads, and marks adAttr (the bid
            # information of shopping ads) as required on update, so the whole ad is sent back.
            obj = self._request("GET", f"/ncc/ads/{unit.id}")
            attr, was_string = _adattr(obj)
            attr["bidAmt"] = int(bid)
            if "useGroupBidAmt" in attr:
                attr["useGroupBidAmt"] = self._flag(attr["useGroupBidAmt"], False)
            obj["adAttr"] = json.dumps(attr) if was_string else attr
            self._request("PUT", f"/ncc/ads/{unit.id}", body=obj)
        elif unit.level == "adgroup":
            obj = self._request("GET", f"/ncc/adgroups/{unit.id}")
            obj["bidAmt"] = int(bid)
            self._request("PUT", f"/ncc/adgroups/{unit.id}", params={"fields": "bidAmt"}, body=obj)
        else:
            obj = self._request("GET", f"/ncc/keywords/{unit.id}")
            obj["bidAmt"] = int(bid)
            obj["useGroupBidAmt"] = self._flag(obj.get("useGroupBidAmt"), False)
            self._request("PUT", "/ncc/keywords", params={"fields": "bidAmt"}, body=[obj])

    def set_campaign_budget(self, campaign_id: str, amount: int) -> None:
        obj = self._request("GET", f"/ncc/campaigns/{campaign_id}")
        obj["useDailyBudget"] = True
        obj["dailyBudget"] = int(amount)
        self._request("PUT", f"/ncc/campaigns/{campaign_id}", params={"fields": "budget"}, body=obj)

    # ---- diagnostics
    def _probe_stats(self, ids: list, since: date, until: date) -> dict:
        """Which /stats fields does this account accept? Tries all at once, then one by one."""
        def call(fields):
            return self._request("GET", "/stats", params={
                "ids": ids, "fields": json.dumps(fields),
                "timeRange": json.dumps({"since": since.isoformat(), "until": until.isoformat()})})

        try:
            return {"accepted": PROBE_STAT_FIELDS, "rows": call(PROBE_STAT_FIELDS)}
        except RateLimited:
            raise
        except ApiError as err:
            out: dict = {"combined_error": str(err), "accepted": [], "rejected": {}, "rows": {}}
            for name in PROBE_STAT_FIELDS:
                try:
                    out["rows"][name] = call([name])
                    out["accepted"].append(name)
                except RateLimited:
                    raise
                except ApiError as single:
                    out["rejected"][name] = str(single)
            return out

    def probe(self, today: date, sample: int = 3) -> dict:
        """Dump raw API shapes so field names can be confirmed before going live (read-only)."""
        result: dict = {"campaigns": self._request("GET", "/ncc/campaigns")}
        camps = [c for c in result["campaigns"] or []
                 if not self.campaign_types or c.get("campaignTp") in self.campaign_types]
        result["campaigns_matching_filter"] = len(camps)
        if not camps:
            return result
        groups = self._request("GET", "/ncc/adgroups", params={"nccCampaignId": camps[0]["nccCampaignId"]}) or []
        result["adgroups_sample"] = groups[:sample]
        stat_ids = [g["nccAdgroupId"] for g in groups[:sample]]
        if groups:
            ads = self._request("GET", "/ncc/ads", params={"nccAdgroupId": groups[0]["nccAdgroupId"]}) or []
            result["ads_sample"] = ads[:sample]
            result["ad_types_seen"] = sorted({a.get("type") for a in ads})
            stat_ids += [a["nccAdId"] for a in ads[:sample]]
        if stat_ids:
            since = date.fromordinal(today.toordinal() - 7)
            result["stats_fields"] = self._probe_stats(stat_ids, since, date.fromordinal(today.toordinal() - 1))
        return result
