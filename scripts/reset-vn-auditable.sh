#!/usr/bin/env bash
# Safe, manual, auditable "start fresh" for the Vietnam research database.
# This script MUST NOT be run while any trendlab worker/serve process is active.
# It DOES NOT enable/start systemd or make external API requests.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DB="$ROOT/data/trendlab.sqlite"
ACTION="${1:---inspect}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
UNIT_SVCS=(trendlab-monitor.service trendlab-collect.service trendlab-discover.service trendlab-analytics.service trendlab-backup.service trendlab-web.service)
UNIT_TIMERS=(trendlab-collect.timer trendlab-discover.timer trendlab-analytics.timer trendlab-backup.timer)

inspect() {
  echo "=== TrendLab process inventory (UTC $(date -u +%FT%TZ)) ==="
  systemctl list-units --all 'trendlab-*' || true
  systemctl list-timers --all | grep -i trendlab || true
  ps -eo pid,ppid,args | grep -E '[n]ode .*bin/cli[.]js' || true
  ss -ltnp | grep ':8080' || true
  printf '\nDatabase files:\n'
  ls -lh "$DB" "$DB-wal" "$DB-shm" 2>/dev/null || true
  printf '\nJournal permissions: '
  journalctl --no-pager -n 1 -u trendlab-monitor.service >/dev/null 2>&1 && echo readable || echo restricted
}

ensure_quiescent() {
  for unit in "${UNIT_SVCS[@]}"; do
    if systemctl is-active --quiet "$unit"; then
      echo "ERROR: $unit is active. Stop it before reset." >&2
      exit 2
    fi
  done
  for unit in "${UNIT_TIMERS[@]}"; do
    if systemctl is-active --quiet "$unit"; then
      echo "ERROR: $unit timer is active. Disable --now before reset." >&2
      exit 2
    fi
  done
  if pgrep -af '[n]ode .*bin/cli[.]js' >/dev/null; then
    echo "ERROR: TrendLab node CLI processes still exist; inspect them before reset:" >&2
    pgrep -af '[n]ode .*bin/cli[.]js' >&2 || true
    exit 2
  fi
  if command -v fuser >/dev/null 2>&1 &&
      { fuser -s "$DB" 2>/dev/null || fuser -s "$DB-wal" 2>/dev/null; }; then
    echo 'ERROR: the database is still open; stop all readers/writers.' >&2
    exit 2
  fi
  if [ ! -f "$DB" ]; then
    echo "ERROR: $DB does not exist. Refusing an unexpected reset." >&2
    exit 2
  fi
  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo 'ERROR: install sqlite3 first.' >&2
    exit 2
  fi
}

snapshot() {
  local target="$1"
  mkdir -p "$target"
  # Include historical logs already captured by the live server and the
  # exact old unit configuration. Journal export is limited to accessible logs.
  systemctl list-units --all 'trendlab-*' >"$target/units-list.txt" 2>&1 || true
  systemctl list-timers --all >"$target/timers-list.txt" 2>&1 || true
  systemctl cat "${UNIT_SVCS[@]}" "${UNIT_TIMERS[@]}" >"$target/unit-definitions.txt" 2>&1 || true
  ps -eo pid,ppid,args >"$target/process-inventory.txt" 2>&1 || true
  crontab -l >"$target/user-crontab.txt" 2>&1 || true
  journalctl --no-pager -o json \
    -u trendlab-monitor.service -u trendlab-collect.service \
    -u trendlab-discover.service -u trendlab-analytics.service \
    -u trendlab-backup.service -u trendlab-web.service \
    >"$target/journal-before-reset.jsonl" 2>"$target/journal-warning.txt" || true
  cp config/default.json "$target/config-before-reset.json"
  git rev-parse HEAD >"$target/git-revision.txt" 2>&1 || true
  echo "$STAMP" >"$target/created-utc.txt"
  # Existing JSONL files move into the archive only AFTER the backup passes.

  local integrity
  integrity="$(sqlite3 "$DB" 'PRAGMA integrity_check;')"
  printf '%s\n' "$integrity" >"$target/integrity-original.txt"
  if [ "$integrity" != 'ok' ]; then
    echo 'ERROR: original database failed integrity_check; it will NOT be reset.' >&2
    exit 3
  fi
  sqlite3 "$DB" ".backup '$target/pre-reset.sqlite'"
  test "$(sqlite3 "$target/pre-reset.sqlite" 'PRAGMA integrity_check;')" = ok ||
    { echo 'ERROR: backup failed integrity check.' >&2; exit 3; }
  sha256sum "$target/pre-reset.sqlite" >"$target/sha256.txt"
}

if [ "$ACTION" = '--inspect' ]; then
  inspect
  exit 0
fi

if [ "$ACTION" != '--reset' ] || [ "${2:-}" != 'CONFIRM_FRESH_VN_DATABASE' ]; then
  echo "Usage: bash scripts/reset-vn-auditable.sh --inspect"
  echo "       bash scripts/reset-vn-auditable.sh --reset CONFIRM_FRESH_VN_DATABASE"
  exit 2
fi

ensure_quiescent
ARCHIVE="$ROOT/backups/reset-$STAMP"
if [ -e "$ARCHIVE" ]; then
  echo "ERROR: archive already exists: $ARCHIVE" >&2
  exit 2
fi
# Another archive is still a full retained copy even after the active DB is reset.
snapshot "$ARCHIVE"

# Keep previous run logs for forensic work, but start new daily JSONL cleanly.
if [ -d "$ROOT/logs" ]; then
  mkdir -p "$ARCHIVE/previous-jsonl"
  shopt -s nullglob
  for old_log in "$ROOT"/logs/events-*.jsonl; do
    mv "$old_log" "$ARCHIVE/previous-jsonl/"
  done
  shopt -u nullglob
fi

# Move old database and WAL companions only AFTER backing up and checking
# quiescence. No recursive deletion, unsafe SQLite deletion or automatic catalog import.
mv "$DB" "$ARCHIVE/live-original.sqlite"
for suffix in -wal -shm; do
  [ ! -e "$DB$suffix" ] || mv "$DB$suffix" "$ARCHIVE/live-original.sqlite$suffix"
done
if [ -f "$ROOT/web/data/data.json" ]; then
  mv "$ROOT/web/data/data.json" "$ARCHIVE/previous-dashboard-data.json"
fi

# Initialize a fresh empty SQLite database; no service starts automatically.
node bin/cli.js coverage >"$ARCHIVE/empty-coverage.json"
node bin/cli.js export >"$ARCHIVE/empty-export.txt"
test "$(sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
echo "RESET COMPLETE: new empty database at $DB"
echo "RESTORABLE ARCHIVE: $ARCHIVE"
echo "Services and timers remain STOPPED. Re-import approved VN candidate sources"
echo "or run a single manual VN sweep before enabling collectors."
