"""Validated, resumable Wikimedia collection using the Python standard library."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews/"
LANGUAGES = {"en": "English", "vi": "Tiếng Việt", "fr": "Français", "de": "Deutsch",
             "ja": "日本語", "es": "Español", "zh": "中文", "ko": "한국어"}
USER_AGENT = "TrendLab/0.1 (https://github.com/geminitt/trendlab) Python-urllib"
WINDOWS = (1, 7, 30)


class SourceError(RuntimeError):
    """A source could not provide validated evidence."""


class RunDeadline(SourceError):
    """The operational run limit was reached; cached progress is reusable."""


def language_code(value):
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,30}", value):
        raise ValueError("Use a Wikipedia language code, such as en, vi or zh-min-nan")
    return value


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def day_range(start, end):
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def title_key(value):
    return value.replace("_", " ")


class Cache:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS responses (
            url TEXT PRIMARY KEY, fetched_at TEXT NOT NULL,
            sha256 TEXT NOT NULL, body TEXT NOT NULL)""")
        self.db.commit()

    def get(self, url):
        row = self.db.execute(
            "SELECT body, sha256, fetched_at FROM responses WHERE url=?", (url,)
        ).fetchone()
        if row is None:
            return None
        body, digest, fetched_at = row
        if hashlib.sha256(body.encode()).hexdigest() != digest:
            raise SourceError("Cached response hash mismatch: " + url)
        return json.loads(body), {"url": url, "sha256": digest, "fetchedAt": fetched_at}

    def put(self, url, body):
        digest = hashlib.sha256(body.encode()).hexdigest()
        fetched_at = utc_now()
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO responses VALUES (?, ?, ?, ?)",
                            (url, fetched_at, digest, body))
        return {"url": url, "sha256": digest, "fetchedAt": fetched_at}

    def close(self):
        self.db.close()


class Client:
    def __init__(self, cache, *, refresh=False, spacing=0.25, deadline_seconds=600,
                 opener=urlopen, sleep=time.sleep):
        self.cache = cache
        self.refresh = refresh
        self.spacing = spacing
        self.deadline = time.monotonic() + deadline_seconds
        self.opener = opener
        self.sleep = sleep
        self.last_request = 0.0
        self.network_requests = 0
        self.cache_hits = 0

    def remaining(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise RunDeadline("Run deadline reached. Repeat the command to resume from cache.")
        return remaining

    def pause(self, seconds):
        if seconds >= self.remaining():
            raise RunDeadline("Retry/spacing exceeds run deadline. Resume from cache.")
        self.sleep(max(0, seconds))

    def get(self, url, validate):
        self.remaining()
        if not self.refresh:
            cached = self.cache.get(url)
            if cached:
                validate(cached[0])
                self.cache_hits += 1
                return cached
        for attempt in range(4):
            self.pause(max(0, self.last_request + self.spacing - time.monotonic()))
            self.last_request = time.monotonic()
            self.network_requests += 1
            try:
                request = Request(url, headers={"User-Agent": USER_AGENT,
                                               "Accept": "application/json"})
                with self.opener(request, timeout=min(20, self.remaining())) as response:
                    raw = response.read(12 * 1024 * 1024 + 1)
                if len(raw) > 12 * 1024 * 1024:
                    raise SourceError("Source response exceeds 12 MiB: " + url)
                body = raw.decode("utf-8")
                payload = json.loads(body)
                validate(payload)
                evidence = self.cache.put(url, body)
                return payload, evidence
            except HTTPError as error:
                error.close()
                if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                    raise
                retry_after = error.headers.get("Retry-After", "") if error.headers else ""
                delay = max(2 ** attempt, float(retry_after) if retry_after.isdigit() else 0)
                # Honor long cooldowns by stopping, rather than retrying early.
                if delay > 30:
                    raise SourceError("Provider requested a long cooldown; resume later") from error
                self.pause(delay)
            except (URLError, TimeoutError, ConnectionError) as error:
                if attempt == 3:
                    raise SourceError("Request failed after bounded retries: " + url) from error
                self.pause(2 ** attempt)
            except (ValueError, KeyError, TypeError, UnicodeError) as error:
                raise SourceError("Invalid source payload: " + url + ": " + str(error)) from error


def validate_top(payload, language, end):
    items = payload["items"]
    if len(items) != 1:
        raise ValueError("Expected one daily chart")
    row = items[0]
    if (row["project"].removesuffix(".org") != language + ".wikipedia"
            or row["access"] != "all-access"
            or (int(row["year"]), int(row["month"]), int(row["day"]))
            != (end.year, end.month, end.day)):
        raise ValueError("Chart identity/date mismatch")
    articles = row["articles"]
    if not isinstance(articles, list) or not 1 <= len(articles) <= 1000:
        raise ValueError("Expected 1 to 1,000 chart entries")
    seen = set()
    for article in articles:
        if (not isinstance(article["article"], str) or not article["article"]
                or article["article"] in seen or type(article["views"]) is not int
                or article["views"] < 0 or type(article["rank"]) is not int
                or article["rank"] < 1):
            raise ValueError("Malformed or duplicate chart entry")
        seen.add(article["article"])


def validate_history(payload, language, title, start, end):
    rows = payload["items"]
    if not isinstance(rows, list):
        raise ValueError("Expected daily items")
    seen = set()
    for row in rows:
        timestamp = row["timestamp"]
        observed = datetime.strptime(timestamp, "%Y%m%d00").date()
        if (row["project"].removesuffix(".org") != language + ".wikipedia"
                or title_key(row["article"]) != title_key(title)
                or row["access"] != "all-access" or row["agent"] != "user"
                or row["granularity"] != "daily" or not start <= observed <= end
                or observed in seen or type(row["views"]) is not int or row["views"] < 0):
            raise ValueError("History identity/date/value mismatch")
        seen.add(observed)


def validate_metadata(payload):
    if "error" in payload or "warnings" in payload:
        raise ValueError("MediaWiki metadata error/warning")
    query = payload["query"]
    if not query["general"]["mainpage"] or not isinstance(query["pages"], list):
        raise ValueError("Missing namespace metadata")


def get_chart(client, language, requested_end=None):
    latest = datetime.now(timezone.utc).date() - timedelta(days=1)
    if requested_end and requested_end > latest:
        raise ValueError("The end date must be a completed UTC day")
    for offset in range(7 if requested_end is None else 1):
        end = requested_end or latest - timedelta(days=offset)
        url = BASE + f"top/{language}.wikipedia.org/all-access/{end:%Y/%m/%d}"
        try:
            payload, evidence = client.get(url, lambda p: validate_top(p, language, end))
            return end, payload["items"][0]["articles"], evidence
        except HTTPError as error:
            if error.code != 404 or requested_end is not None:
                raise
    raise SourceError("No complete chart found in the previous seven UTC days")


def select_articles(client, language, chart, limit):
    selected, evidence = [], []
    excluded = {"nonArticle": 0, "mainPage": 0, "missingMetadata": 0}
    inspected = 0
    for offset in range(0, len(chart), 50):
        batch = chart[offset:offset + 50]
        params = {"action": "query", "format": "json", "formatversion": "2",
                  "prop": "info", "meta": "siteinfo", "siprop": "general",
                  "titles": "|".join(row["article"] for row in batch)}
        url = f"https://{language}.wikipedia.org/w/api.php?" + urlencode(params)
        payload, source = client.get(url, validate_metadata)
        evidence.append(source)
        query = payload["query"]
        mainpage = title_key(query["general"]["mainpage"])
        pages = {title_key(p["title"]): p for p in query["pages"]}
        normalized = {title_key(p["from"]): title_key(p["to"])
                      for p in query.get("normalized", [])}
        for row in batch:
            inspected += 1
            key = title_key(row["article"])
            page = pages.get(normalized.get(key, key))
            if page is None or "missing" in page or "invalid" in page:
                excluded["missingMetadata"] += 1
            elif page["ns"] != 0:
                excluded["nonArticle"] += 1
            elif title_key(page["title"]) == mainpage:
                excluded["mainPage"] += 1
            else:
                selected.append(row)
            if len(selected) == limit:
                return selected, excluded, inspected, evidence
    return selected, excluded, inspected, evidence


def summarize_window(history, end, days):
    start = end - timedelta(days=days - 1)
    prior_end = start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=days - 1)
    current_dates = day_range(start, end)
    previous_dates = day_range(prior_start, prior_end)
    missing = [d.isoformat() for d in current_dates if d.isoformat() not in history]
    previous_missing = [d.isoformat() for d in previous_dates if d.isoformat() not in history]
    views = None if missing else sum(history[d.isoformat()] for d in current_dates)
    previous = None if previous_missing else sum(history[d.isoformat()] for d in previous_dates)
    delta = None if views is None or previous is None else views - previous
    change = None if delta is None or previous == 0 else 100 * delta / previous
    status = ("missing_history" if delta is None else
              "zero_baseline" if previous == 0 else "comparable")
    return {"start": start.isoformat(), "end": end.isoformat(), "days": days,
            "previousStart": prior_start.isoformat(), "previousEnd": prior_end.isoformat(),
            "views": views, "previousViews": previous, "delta": delta,
            "changePct": change, "status": status,
            "missingDays": missing, "previousMissingDays": previous_missing}


def collect_edition(client, language, limit=100, end=None):
    language_code(language)
    if not 1 <= limit <= 1000:
        raise ValueError("Article limit must be between 1 and 1,000")
    end, chart, chart_source = get_chart(client, language, end)
    selected, excluded, inspected, metadata_sources = select_articles(client, language, chart, limit)
    start = end - timedelta(days=59)
    articles, failures = [], []
    for index, entry in enumerate(selected, 1):
        title = entry["article"]
        url = BASE + (f"per-article/{language}.wikipedia.org/all-access/user/"
                      f"{quote(title, safe='')}/daily/{start:%Y%m%d}00/{end:%Y%m%d}00")
        try:
            payload, source = client.get(
                url, lambda p: validate_history(p, language, title, start, end))
            history = {datetime.strptime(p["timestamp"], "%Y%m%d00").date().isoformat(): p["views"]
                       for p in payload["items"]}
            articles.append({"title": title, "label": title_key(title),
                             "url": f"https://{language}.wikipedia.org/wiki/{quote(title, safe='')}",
                             "discoveryRank": entry["rank"],
                             "history": [{"date": day.isoformat(), "views": history.get(day.isoformat())}
                                         for day in day_range(start, end)],
                             "windows": {str(days): summarize_window(history, end, days)
                                         for days in WINDOWS}, "source": source})
        except RunDeadline:
            raise
        except (SourceError, HTTPError) as error:
            failures.append({"title": title, "error": str(error), "url": url})
        print(f"[{language}] {index}/{len(selected)} {title}", flush=True)
    if not articles:
        raise SourceError("No validated article histories collected; previous export preserved")
    return {"schemaVersion": 1, "meta": {
                "language": language, "label": LANGUAGES.get(language, language),
                "project": language + ".wikipedia.org", "endDate": end.isoformat(),
                "generatedAt": utc_now(), "agent": "user", "access": "all-access",
                "windows": list(WINDOWS), "historyStart": start.isoformat(),
                "chartEntries": len(chart), "inspectedEntries": inspected,
                "requestedArticles": limit, "selectedArticles": len(selected),
                "exportedArticles": len(articles), "excluded": excluded,
                "failures": failures, "status": "partial" if failures else "complete",
                "selection": "Articles selected by daily Top 1,000 rank, after namespace/main-page filtering. Not all Wikipedia articles.",
                "chartSource": chart_source, "metadataSources": metadata_sources},
            "articles": articles}


def atomic_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    # Serialize before replacing anything. Reject NaN/Infinity in artifacts.
    body = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    try:
        with temporary.open("w", encoding="utf-8") as output:
            output.write(body)
            output.flush()
            import os
            os.fsync(output.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return hashlib.sha256(body.encode()).hexdigest()


def export_edition(output_dir, dataset):
    output_dir = Path(output_dir)
    meta = dataset["meta"]
    language = language_code(meta["language"])
    # Include content identity so an old manifest always reads a consistent file.
    body = json.dumps(dataset, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    digest = hashlib.sha256(body.encode()).hexdigest()
    filename = f"{language}-{meta['endDate']}-{digest[:12]}.json"
    atomic_json(output_dir / filename, dataset)
    manifest_path = output_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {
        "schemaVersion": 1, "editions": []}
    edition = {"language": language, "label": meta["label"], "endDate": meta["endDate"],
               "file": filename, "sha256": digest, "status": meta["status"],
               "articles": len(dataset["articles"])}
    manifest["editions"] = sorted(
        [row for row in manifest["editions"] if row["language"] != language] + [edition],
        key=lambda row: row["language"])
    manifest["generatedAt"] = utc_now()
    atomic_json(manifest_path, manifest)
    return filename
