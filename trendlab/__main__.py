"""Run with python -m trendlab --help."""

import argparse
import math
import sys
from datetime import date
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .wikipedia import Cache, Client, collect_edition, export_edition, language_code


def positive_duration(value):
    duration = float(value)
    if not math.isfinite(duration) or duration <= 0:
        raise argparse.ArgumentTypeError("deadline must be a finite positive duration")
    return duration


def parser():
    root = argparse.ArgumentParser(description="TrendLab Wikipedia attention treemap")
    commands = root.add_subparsers(dest="command", required=True)
    collect = commands.add_parser("collect", help="Fetch/cache real histories and export static JSON")
    collect.add_argument("--languages", nargs="+", type=language_code, required=True)
    collect.add_argument("--limit", type=int, default=100,
                         help="Maximum articles per edition (1..1000; default 100)")
    collect.add_argument("--end-date", type=date.fromisoformat,
                         help="Completed UTC day; defaults to latest available daily chart")
    collect.add_argument("--cache", default="data/wikipedia.sqlite")
    collect.add_argument("--output", default="web/data/wikipedia")
    collect.add_argument("--refresh", action="store_true", help="Refetch cached source responses")
    collect.add_argument("--deadline-seconds", type=positive_duration, default=600,
                         help="Operational run deadline; repeat to resume (default 600)")
    serve = commands.add_parser("serve", help="Serve the dashboard locally without collecting")
    serve.add_argument("--port", type=int, default=8080)
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--directory", default=str(Path(__file__).resolve().parent.parent / "web"))
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    if args.command == "serve":
        handler = partial(SimpleHTTPRequestHandler, directory=args.directory)
        with ThreadingHTTPServer((args.host, args.port), handler) as server:
            print(f"TrendLab: http://{args.host}:{server.server_port}", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
        return 0
    if not 1 <= args.limit <= 1000 or args.deadline_seconds <= 0:
        parser().error("limit must be 1..1000 and deadline must be positive")
    cache = Cache(args.cache)
    client = Client(cache, refresh=args.refresh, deadline_seconds=args.deadline_seconds)
    failed = False
    try:
        for language in dict.fromkeys(args.languages):
            dataset = collect_edition(client, language, args.limit, args.end_date)
            filename = export_edition(args.output, dataset)
            failed |= dataset["meta"]["status"] != "complete"
            print(f"Exported {language}: {filename} ({dataset['meta']['status']})", flush=True)
        print(f"Network requests: {client.network_requests}; cache hits: {client.cache_hits}", flush=True)
    finally:
        cache.close()
    return 2 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (Exception, KeyboardInterrupt) as error:
        print(f"TrendLab stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
