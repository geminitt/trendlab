"""Verify every exported number against its hashed, cached API response."""

import argparse
import hashlib
import json
import sqlite3
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from trendlab.wikipedia import summarize_window, title_key, validate_history, validate_top


def verify(directory, cache_path):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    db = sqlite3.connect(Path(cache_path).resolve().as_uri() + "?mode=ro", uri=True)
    report = []
    try:
        def source(evidence):
            row = db.execute("SELECT body, sha256 FROM responses WHERE url=?",
                             (evidence["url"],)).fetchone()
            assert row is not None, "Missing cached source: " + evidence["url"]
            assert hashlib.sha256(row[0].encode()).hexdigest() == row[1] == evidence["sha256"]
            return json.loads(row[0])

        for edition in manifest["editions"]:
            raw = (directory / edition["file"]).read_bytes()
            assert hashlib.sha256(raw).hexdigest() == edition["sha256"], "Export hash mismatch"
            data = json.loads(raw)
            meta = data["meta"]
            assert edition["language"] == meta["language"]
            assert meta["project"] == edition["language"] + ".wikipedia.org"
            assert edition["endDate"] == meta["endDate"]
            assert edition["articles"] == len(data["articles"]) == meta["exportedArticles"]
            assert meta["selectedArticles"] == len(data["articles"]) + len(meta["failures"])
            end, start = date.fromisoformat(meta["endDate"]), date.fromisoformat(meta["historyStart"])
            chart = source(meta["chartSource"])
            validate_top(chart, meta["language"], end)
            top = {row["article"]: row for row in chart["items"][0]["articles"]}
            pages, main_pages = {}, set()
            for evidence in meta["metadataSources"]:
                query = source(evidence)["query"]
                pages.update({title_key(p["title"]): p for p in query["pages"]})
                main_pages.add(title_key(query["general"]["mainpage"]))
            seen = set()
            for article in data["articles"]:
                title = article["title"]
                assert title not in seen
                seen.add(title)
                assert title in top and article["discoveryRank"] == top[title]["rank"]
                assert pages[title_key(title)]["ns"] == 0 and title_key(title) not in main_pages
                payload = source(article["source"])
                validate_history(payload, meta["language"], title, start, end)
                history = {datetime.strptime(p["timestamp"], "%Y%m%d00").date().isoformat(): p["views"]
                           for p in payload["items"]}
                assert {p["date"]: p["views"] for p in article["history"] if p["views"] is not None} == history
                for days in meta["windows"]:
                    assert article["windows"][str(days)] == summarize_window(history, end, days), title
            report.append({"language": meta["language"], "endDate": meta["endDate"],
                           "articles": len(seen), "status": meta["status"],
                           "completePeriods": {str(days): sum(a["windows"][str(days)]["views"] is not None
                                                             for a in data["articles"])
                                               for days in meta["windows"]},
                           "views": {str(days): sum(a["windows"][str(days)]["views"] or 0
                                                    for a in data["articles"])
                                     for days in meta["windows"]}})
    finally:
        db.close()
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", default="web/data/wikipedia")
    parser.add_argument("--cache", default="data/wikipedia.sqlite")
    args = parser.parse_args()
    print(json.dumps(verify(args.directory, args.cache), indent=2))
