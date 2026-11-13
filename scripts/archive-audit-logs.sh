#!/usr/bin/env bash
set -euo pipefail

# Non-destructive operator action: only archived copies, NEVER delete the
# original events or the pre-reset archive. Run from any directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MODE="${1:---inspect}"
if [[ "$MODE" != "--inspect" && "$MODE" != "--archive" ]]; then
  echo "Usage: bash scripts/archive-audit-logs.sh [--inspect|--archive]" >&2
  exit 2
fi
SRC="logs"
DEST="backups/audit-jsonl"
if [[ ! -d "$SRC" ]]; then
  echo "NO LOGS: $SRC"
  exit 0
fi

found=0
while IFS= read -r -d '' file; do
  found=$((found + 1))
  base="${file##*/}"
  target="$DEST/$base.gz"
  if [[ "$MODE" == "--inspect" ]]; then
    printf 'ELIGIBLE: %s -> %s\n' "$file" "$target"
    continue
  fi
  mkdir -p "$DEST"
  if [[ -e "$target" ]]; then
    # If a file was altered after initial archival, fail closed; never overwrite.
    original_sum="$(sha256sum "$file" | awk '{print $1}')"
    archived_sum="$(gzip -cd "$target" | sha256sum | awk '{print $1}')"
    if [[ "$original_sum" != "$archived_sum" ]]; then
      echo "ARCHIVE MISMATCH: $target; not overwriting" >&2
      exit 1
    fi
    echo "UNCHANGED: $target"
    continue
  fi
  tmp="$(mktemp "$DEST/.archive.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  gzip -n -9 -c "$file" > "$tmp"
  gzip -t "$tmp"
  source_sum="$(sha256sum "$file" | awk '{print $1}')"
  restored_sum="$(gzip -cd "$tmp" | sha256sum | awk '{print $1}')"
  if [[ "$source_sum" != "$restored_sum" ]]; then
    echo "Checksum mismatch while archiving $file" >&2
    exit 1
  fi
  mv -n "$tmp" "$target"
  sha256sum "$target" > "$target.sha256"
  sha256sum -c "$target.sha256"
  trap - EXIT
  echo "ARCHIVED (original preserved): $target"
done < <(find "$SRC" -maxdepth 1 -type f -name 'events-????-??-??.jsonl' -mtime +7 -print0)
echo "Eligible log files: $found; original logs not deleted."
