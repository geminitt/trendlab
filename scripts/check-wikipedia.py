"""Run local Wikipedia acceptance, including an isolated browser preview."""

import hashlib
import json
import os
import signal
import subprocess
import sys
import threading
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOGS = ROOT / "logs"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_check(name, command, timeout, environment=None):
    try:
        with subprocess.Popen(command, cwd=ROOT, env=environment, start_new_session=True,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as process:
            try:
                output, _ = process.communicate(timeout=timeout)
                code = process.returncode
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                output, _ = process.communicate()
                output += b"\nOperational check deadline exceeded.\n"
                code = 124
    except OSError as error:
        output, code = str(error).encode(), 1
    path = LOGS / name
    path.write_bytes(output)
    print(f"{name}: {'PASS' if code == 0 else 'FAIL'} (exit {code})", flush=True)
    return {"command": command, "exitCode": code,
            "log": str(path.relative_to(ROOT)), "sha256": digest(path)}


def input_manifest():
    files = []
    for folder in ("trendlab", "tests", "src", "test", "web", "scripts", "config", ".github"):
        files.extend(p for p in (ROOT / folder).rglob("*") if p.is_file()
                     and "__pycache__" not in p.parts and p.suffix != ".pyc")
    files.extend(ROOT / name for name in ("README.md", "package.json", "package-lock.json",
                 "pyproject.toml", "pixi.toml", "pixi.lock", ".gitignore"))
    return {str(p.relative_to(ROOT)): digest(p) for p in sorted(set(files))}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    LOGS.mkdir(exist_ok=True)
    inputs_before = input_manifest()
    cache = ROOT / "data/wikipedia.sqlite"
    cache_before = digest(cache) if cache.exists() else None
    checks = [
        run_check("wikipedia-python-suite.log", [sys.executable, "-W", "error::ResourceWarning",
                  "-m", "unittest", "discover", "-s", "tests", "-v"], 45),
        run_check("wikipedia-node-suite.log", ["npm", "test"], 120),
        run_check("wikipedia-data-verification.json", [sys.executable,
                  "scripts/verify_wikipedia.py"], 30),
    ]
    try:
        handler = partial(QuietHandler, directory=str(ROOT / "web"))
        with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                environment = dict(os.environ, TRENDLAB_PREVIEW_URL=
                                   f"http://127.0.0.1:{server.server_port}")
                checks.append(run_check("wikipedia-browser-check.log",
                                        ["npm", "run", "test:browser"], 120, environment))
            finally:
                server.shutdown()
                thread.join(timeout=5)
    except OSError as error:
        checks.append({"command": ["local browser preview"], "exitCode": 1, "error": str(error)})
    unchanged = inputs_before == input_manifest()
    cache_unchanged = cache_before is not None and cache_before == digest(cache)
    report = {"createdAt": datetime.now(timezone.utc).isoformat(),
              "status": "passed" if unchanged and cache_unchanged and
                        all(check["exitCode"] == 0 for check in checks) else "failed",
              "checks": checks, "inputsUnchanged": unchanged,
              "liveCacheUnchanged": cache_unchanged}
    (LOGS / "wikipedia-acceptance.json").write_text(json.dumps(report, indent=2) + "\n")
    (LOGS / "wikipedia-input-manifest.json").write_text(json.dumps({
        "createdAt": report["createdAt"], "python": sys.version,
        "files": inputs_before, "cacheSha256": cache_before,
        "acceptanceSha256": digest(LOGS / "wikipedia-acceptance.json")}, indent=2) + "\n")
    print("Local acceptance:", report["status"], flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
