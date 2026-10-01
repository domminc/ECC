import base64
import hashlib
import hmac
import json
import unittest
import urllib.parse
from datetime import date

from autopilot.models import Stats, Unit
from autopilot.naver_client import ApiError, NaverSearchAdClient, RateLimited, sign


class Script:
    """Scripted transport: returns queued (status, payload) pairs and records requests."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, method, url, headers, body):
        self.requests.append((method, url, headers, body))
        return self.responses.pop(0)


def make_client(script, **kw):
    sleeps = []
    client = NaverSearchAdClient("KEY", "SECRET", "123", transport=script, sleep=sleeps.append,
                                 clock=lambda: 1_700_000_000.0, min_interval=0, **kw)
    return client, sleeps


def official_signature(timestamp, method, uri, secret):
    """The algorithm from naver/searchad-apidoc python-sample/signaturehelper.py."""
    message = "{}.{}.{}".format(timestamp, method, uri)
    digest = hmac.new(bytes(secret, "utf-8"), bytes(message, "utf-8"), hashlib.sha256)
    return base64.b64encode(digest.digest()).decode()


class SignatureTests(unittest.TestCase):
    def test_matches_official_sample_algorithm(self):
        self.assertEqual(sign("secret", "1700000000000", "GET", "/ncc/campaigns"),
                         official_signature("1700000000000", "GET", "/ncc/campaigns", "secret"))

    def test_request_headers_and_query_string_is_not_signed(self):
        script = Script((200, []))
        client, _ = make_client(script)
        client._request("GET", "/ncc/adgroups", params={"nccCampaignId": "cmp-1"})
        method, url, headers, _ = script.requests[0]
        self.assertEqual(url, "https://api.searchad.naver.com/ncc/adgroups?nccCampaignId=cmp-1")
        self.assertEqual(headers["X-API-KEY"], "KEY")
        self.assertEqual(headers["X-Customer"], "123")
        self.assertEqual(headers["X-Timestamp"], "1700000000000")
        self.assertEqual(headers["X-Signature"],
                         official_signature("1700000000000", "GET", "/ncc/adgroups", "SECRET"))


class RetryTests(unittest.TestCase):
    def test_backs_off_on_429_then_succeeds(self):  # TC-10
        script = Script((429, "slow down"), (429, "slow down"), (200, [{"ok": 1}]))
        client, sleeps = make_client(script)
        self.assertEqual(client._request("GET", "/ncc/campaigns"), [{"ok": 1}])
        self.assertEqual(len(script.requests), 3)
        self.assertEqual(len(sleeps), 2)
        self.assertGreaterEqual(sleeps[1], sleeps[0])  # waits grow

    def test_error_code_1016_is_treated_like_429(self):
        script = Script((400, {"code": 1016, "title": "Too many connections"}), (200, []))
        client, sleeps = make_client(script)
        client._request("GET", "/ncc/campaigns")
        self.assertEqual(len(sleeps), 1)

    def test_gives_up_with_rate_limited_after_max_retries(self):  # TC-10
        script = Script(*[(429, "x")] * 10)
        client, _ = make_client(script, max_retries=3)
        with self.assertRaises(RateLimited):
            client._request("GET", "/ncc/campaigns")
        self.assertEqual(len(script.requests), 4)

    def test_other_client_errors_are_not_retried(self):
        script = Script((400, {"code": 2102, "title": "bad bid"}))
        client, sleeps = make_client(script)
        with self.assertRaises(ApiError):
            client._request("PUT", "/ncc/adgroups/x")
        self.assertEqual((len(script.requests), sleeps), (1, []))


class ReadTests(unittest.TestCase):
    def test_list_units_for_adgroup_level(self):
        script = Script(
            (200, [{"nccCampaignId": "c1", "campaignTp": "SHOPPING", "userLock": False, "useDailyBudget": True,
                    "dailyBudget": 50000},
                   {"nccCampaignId": "c2", "campaignTp": "WEB_SITE", "userLock": False},
                   {"nccCampaignId": "c3", "campaignTp": "SHOPPING", "userLock": True, "delFlag": True}]),
            (200, [{"nccAdgroupId": "g1", "name": "원피스", "userLock": False, "bidAmt": 400},
                   {"nccAdgroupId": "g2", "name": "가방", "userLock": True, "bidAmt": 250},
                   {"nccAdgroupId": "g3", "name": "삭제됨", "delFlag": True}]))
        client, _ = make_client(script)
        units = client.list_units()
        self.assertEqual([(u.id, u.name, u.on, u.bid, u.parent_on, u.campaign_daily_budget) for u in units],
                         [("g1", "원피스", True, 400, True, 50000), ("g2", "가방", False, 250, True, 50000)])
        self.assertEqual(len(script.requests), 2)  # WEB_SITE and deleted campaigns are skipped

    def test_list_units_for_keyword_level_uses_group_bid_when_inherited(self):
        script = Script(
            (200, [{"nccCampaignId": "c1", "campaignTp": "SHOPPING", "userLock": False}]),
            (200, [{"nccAdgroupId": "g1", "name": "g", "userLock": False, "bidAmt": 300}]),
            (200, [{"nccKeywordId": "k1", "keyword": "원피스", "userLock": False, "bidAmt": 999, "useGroupBidAmt": True},
                   {"nccKeywordId": "k2", "keyword": "여름", "userLock": False, "bidAmt": 500, "useGroupBidAmt": False}]))
        client, _ = make_client(script, level="keyword")
        units = client.list_units()
        self.assertEqual([(u.id, u.bid, u.uses_group_bid) for u in units], [("k1", 300, True), ("k2", 500, False)])

    def test_get_stats_parses_rows_and_fills_missing_ids(self):
        script = Script((200, {"data": [{"id": "g1", "impCnt": 900, "clkCnt": 30, "salesAmt": 9000,
                                         "purchaseCcnt": 2, "purchaseConvAmt": 60000}]}))
        client, _ = make_client(script)
        out = client.get_stats(["g1", "g2"], date(2026, 3, 1), date(2026, 3, 9))
        self.assertEqual(out["g1"], Stats(900, 30, 9000.0, 2.0, 60000.0))
        self.assertEqual(out["g2"], Stats())
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(script.requests[0][1]).query)
        self.assertEqual(query["ids"], ["g1", "g2"])
        self.assertEqual(json.loads(query["timeRange"][0]), {"since": "2026-03-01", "until": "2026-03-09"})
        self.assertEqual(json.loads(query["fields"][0]), ["impCnt", "clkCnt", "salesAmt", "purchaseCcnt", "purchaseConvAmt"])

    def test_get_stats_chunks_large_id_lists(self):
        ids = [f"g{i}" for i in range(120)]
        script = Script((200, {"data": []}), (200, {"data": []}), (200, {"data": []}))
        client, _ = make_client(script, stat_chunk=50)
        out = client.get_stats(ids, date(2026, 3, 1), date(2026, 3, 9))
        self.assertEqual((len(script.requests), len(out)), (3, 120))


class WriteTests(unittest.TestCase):
    def test_adgroup_off_mirrors_the_returned_flag_type(self):
        script = Script((200, {"nccAdgroupId": "g1", "userLock": False}), (200, {}),
                        (200, {"nccAdgroupId": "g1", "userLock": 0}), (200, {}))
        client, _ = make_client(script)
        unit = Unit("g1", "g", "adgroup", "c1", True, 400)
        client.set_unit_on(unit, False)
        client.set_unit_on(unit, False)
        method, url, _, body = script.requests[1]
        self.assertEqual((method, url), ("PUT", "https://api.searchad.naver.com/ncc/adgroups/g1?fields=userLock"))
        self.assertIs(body["userLock"], True)
        self.assertEqual(script.requests[3][3]["userLock"], 1)

    def test_keyword_bid_detaches_from_group_bid(self):
        script = Script((200, {"nccKeywordId": "k1", "bidAmt": 300, "useGroupBidAmt": True}), (200, []))
        client, _ = make_client(script)
        client.set_bid(Unit("k1", "k", "keyword", "c1", True, 300, uses_group_bid=True), 350)
        method, url, _, body = script.requests[1]
        self.assertEqual((method, url), ("PUT", "https://api.searchad.naver.com/ncc/keywords?fields=bidAmt"))
        self.assertEqual(body[0]["bidAmt"], 350)
        self.assertIs(body[0]["useGroupBidAmt"], False)


if __name__ == "__main__":
    unittest.main()
