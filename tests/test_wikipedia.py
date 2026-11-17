import hashlib
import io
import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, unquote, urlparse
from unittest.mock import patch

from trendlab.wikipedia import (BASE, Cache, Client, RunDeadline, SourceError,
                                collect_edition, day_range, export_edition,
                                language_code, summarize_window, validate_history)

END = date(2026, 11, 12)
START = END - timedelta(days=59)


def history(title="Alpha", missing=None, language="en", count=100):
    return {"items": [{"project": language + ".wikipedia", "article": title,
                       "access": "all-access", "agent": "user", "granularity": "daily",
                       "timestamp": day.strftime("%Y%m%d00"), "views": count}
                      for day in day_range(START, END) if day != missing]}


class FakeSource:
    def __init__(self):
        self.calls = []
        self.fail_title = None

    def __call__(self, request, timeout):
        self.calls.append(request.full_url)
        if "/top/" in request.full_url:
            payload = {"items": [{"project": "en.wikipedia", "access": "all-access",
                "year": "2026", "month": "11", "day": "12", "articles": [
                    {"article": "Main_Page", "views": 999999, "rank": 1},
                    {"article": "Special:Search", "views": 88888, "rank": 2},
                    {"article": "Alpha", "views": 77777, "rank": 3},
                    {"article": "Film:_Part_1", "views": 66666, "rank": 4}]}]}
        elif "/w/api.php?" in request.full_url:
            payload = {"query": {"general": {"mainpage": "Main Page"}, "pages": [
                {"title": "Main Page", "ns": 0}, {"title": "Special:Search", "ns": -1},
                {"title": "Alpha", "ns": 0}, {"title": "Film: Part 1", "ns": 0}]}}
        else:
            title = unquote(request.full_url.split("/user/")[1].split("/daily/")[0])
            if title == self.fail_title:
                raise HTTPError(request.full_url, 404, "Not found", {}, None)
            payload = history(title)
        return io.BytesIO(json.dumps(payload).encode())


class WindowTests(unittest.TestCase):
    def test_cli_deadline_requires_a_finite_positive_duration(self):
        from trendlab.__main__ import parser
        import contextlib
        for value in ("nan", "inf", "0", "-1"):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                parser().parse_args(["collect", "--languages", "en", "--deadline-seconds", value])

    def test_equal_length_periods_and_exact_change(self):
        rows = {d.isoformat(): 100 if d <= END - timedelta(days=7) else 200
                for d in day_range(START, END)}
        result = summarize_window(rows, END, 7)
        self.assertEqual((result["views"], result["previousViews"], result["delta"],
                          result["changePct"]), (1400, 700, 700, 100))
        self.assertEqual(result["start"], "2026-11-06")
        self.assertEqual(result["previousEnd"], "2026-11-05")

    def test_missing_current_and_prior_dates_are_not_zero_filled(self):
        rows = {d.isoformat(): 0 for d in day_range(START, END)}
        rows.pop(END.isoformat())
        result = summarize_window(rows, END, 7)
        self.assertIsNone(result["views"])
        self.assertEqual(result["previousViews"], 0)
        self.assertEqual(result["status"], "missing_history")
        rows[END.isoformat()] = 0
        rows.pop((END - timedelta(days=10)).isoformat())
        result = summarize_window(rows, END, 7)
        self.assertEqual(result["views"], 0)
        self.assertIsNone(result["previousViews"])
        self.assertIsNone(result["changePct"])

    def test_zero_baseline_remains_distinct_from_zero_growth(self):
        rows = {d.isoformat(): 0 for d in day_range(START, END)}
        rows[END.isoformat()] = 5
        result = summarize_window(rows, END, 1)
        self.assertEqual(result["delta"], 5)
        self.assertIsNone(result["changePct"])
        self.assertEqual(result["status"], "zero_baseline")
        rows[(END - timedelta(days=1)).isoformat()] = 5
        self.assertEqual(summarize_window(rows, END, 1)["changePct"], 0)

    def test_month_uses_sixty_complete_days(self):
        rows = {d.isoformat(): 3 for d in day_range(START, END)}
        result = summarize_window(rows, END, 30)
        self.assertEqual(result["views"], 90)
        self.assertEqual(result["previousViews"], 90)
        self.assertEqual(result["previousStart"], START.isoformat())

    def test_history_identity_duplicates_and_negative_counts_are_rejected(self):
        for mutation in (lambda r: r.update(project="vi.wikipedia"),
                         lambda r: r.update(agent="all-agents"),
                         lambda r: r.update(article="Other"),
                         lambda r: r.update(views=-1),
                         lambda r: r.update(views=True)):
            payload = history()
            mutation(payload["items"][0])
            with self.assertRaises(ValueError):
                validate_history(payload, "en", "Alpha", START, END)
        payload = history()
        payload["items"].append(payload["items"][0])
        with self.assertRaises(ValueError):
            validate_history(payload, "en", "Alpha", START, END)

    def test_language_does_not_allow_host_or_path_injection(self):
        self.assertEqual(language_code("zh-min-nan"), "zh-min-nan")
        for value in ("en.wikipedia.org", "../en", "en/", "en?x", "EN", ""):
            with self.assertRaises(ValueError):
                language_code(value)


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cache = Cache(Path(self.temp.name) / "cache.sqlite")
        self.source = FakeSource()

    def tearDown(self):
        self.cache.close()
        self.temp.cleanup()

    def client(self, **kwargs):
        return Client(self.cache, opener=self.source, spacing=0, **kwargs)

    def test_real_flow_filters_namespaces_keeps_colon_titles_and_uses_history(self):
        result = collect_edition(self.client(), "en", 2, END)
        self.assertEqual([a["title"] for a in result["articles"]], ["Alpha", "Film:_Part_1"])
        self.assertEqual(result["meta"]["excluded"],
                         {"mainPage": 1, "nonArticle": 1, "missingMetadata": 0})
        self.assertEqual(result["articles"][0]["windows"]["1"]["views"], 100)
        self.assertNotEqual(result["articles"][0]["windows"]["1"]["views"], 77777)
        self.assertEqual(result["articles"][1]["url"],
                         "https://en.wikipedia.org/wiki/Film%3A_Part_1")

    def test_resume_after_reopen_makes_no_network_requests(self):
        first = collect_edition(self.client(), "en", 2, END)
        self.cache.close()
        self.cache = Cache(Path(self.temp.name) / "cache.sqlite")
        def forbidden(*args, **kwargs):
            self.fail("Completed request repeated after resume")
        client = Client(self.cache, opener=forbidden, spacing=0)
        second = collect_edition(client, "en", 2, END)
        self.assertEqual(first["articles"], second["articles"])
        self.assertEqual(client.cache_hits, 4)

    def test_failed_article_is_reported_and_never_uses_chart_count(self):
        self.source.fail_title = "Alpha"
        result = collect_edition(self.client(), "en", 2, END)
        self.assertEqual(result["meta"]["status"], "partial")
        self.assertEqual(result["meta"]["failures"][0]["title"], "Alpha")
        self.assertEqual([a["title"] for a in result["articles"]], ["Film:_Part_1"])
        self.source.fail_title = None
        result = collect_edition(self.client(), "en", 2, END)
        self.assertEqual(result["meta"]["status"], "complete")
        self.assertEqual(len(self.source.calls), 5, "Only the failed request should be resumed")

    def test_invalid_response_is_not_cached_and_cooldown_is_honored(self):
        def wrong(request, timeout):
            return io.BytesIO(b'{"items":[]}')
        client = Client(self.cache, opener=wrong, spacing=0)
        with self.assertRaises(SourceError):
            client.get("https://example.test/invalid", lambda p: p["required"])
        self.assertIsNone(self.cache.get("https://example.test/invalid"))
        calls = []
        def limited(request, timeout):
            calls.append(request.full_url)
            raise HTTPError(request.full_url, 429, "Cooldown", {"Retry-After": "120"}, None)
        client = Client(self.cache, opener=limited, spacing=0)
        with self.assertRaises(SourceError):
            client.get("https://example.test/limited", lambda p: None)
        self.assertEqual(len(calls), 1)

    def test_transient_failure_has_bounded_retries_and_respects_deadline(self):
        calls = []
        def unavailable(request, timeout):
            calls.append(request.full_url)
            raise HTTPError(request.full_url, 503, "Unavailable", {}, None)
        client = Client(self.cache, opener=unavailable, sleep=lambda _: None, spacing=0)
        with self.assertRaises(HTTPError):
            client.get("https://example.test/503", lambda p: None)
        self.assertEqual(len(calls), 4)
        client = Client(self.cache, opener=unavailable, spacing=0, deadline_seconds=-1)
        with self.assertRaises(RunDeadline):
            client.get("https://example.test/deadline", lambda p: None)

    def test_cache_integrity_is_checked(self):
        self.cache.put("https://example.test/hash", '{"ok":true}')
        self.cache.db.execute("UPDATE responses SET body='{}'")
        self.cache.db.commit()
        with self.assertRaisesRegex(SourceError, "hash mismatch"):
            self.cache.get("https://example.test/hash")

    def test_manifest_preserves_editions_and_old_immutable_exports(self):
        output = Path(self.temp.name) / "site"
        data = collect_edition(self.client(), "en", 2, END)
        old_filename = export_edition(output, data)
        old_contents = (output / old_filename).read_bytes()
        data["meta"]["language"] = "vi"
        data["meta"]["label"] = "Tiếng Việt"
        export_edition(output, data)
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual([e["language"] for e in manifest["editions"]], ["en", "vi"])
        self.assertEqual((output / old_filename).read_bytes(), old_contents)
        for edition in manifest["editions"]:
            self.assertEqual(hashlib.sha256((output / edition["file"]).read_bytes()).hexdigest(),
                             edition["sha256"])

    def test_cli_reports_partial_failure_and_recovers_without_repeating_successes(self):
        from trendlab.__main__ import main
        self.source.fail_title = "Alpha"
        output = Path(self.temp.name) / "cli-output"
        args = ["collect", "--languages", "en", "--limit", "2",
                "--end-date", END.isoformat(), "--cache", str(Path(self.temp.name) / "cli.sqlite"),
                "--output", str(output)]
        def client_factory(cache, **kwargs):
            return Client(cache, opener=self.source, spacing=0, **kwargs)
        with patch("trendlab.__main__.Client", side_effect=client_factory):
            self.assertEqual(main(args), 2)
            self.source.fail_title = None
            self.assertEqual(main(args), 0)
        self.assertEqual(len(self.source.calls), 5)
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual(manifest["editions"][0]["status"], "complete")

    def test_deadline_preserves_last_good_manifest_and_cached_progress(self):
        output = Path(self.temp.name) / "deadline"
        export_edition(output, collect_edition(self.client(), "en", 2, END))
        before = (output / "manifest.json").read_bytes()
        with self.assertRaises(RunDeadline):
            collect_edition(self.client(deadline_seconds=-1), "en", 2, END)
        self.assertEqual((output / "manifest.json").read_bytes(), before)
        self.assertEqual(len(collect_edition(self.client(), "en", 2, END)["articles"]), 2)


if __name__ == "__main__":
    unittest.main()
