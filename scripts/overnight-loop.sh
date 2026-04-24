#!/usr/bin/env bash
# Control CLI for the dev-agent overnight loop recurrence.
#
# v2 rewrite: recurrences live in the session's inbound.db as rows in
# `messages_in` with `recurrence` set (cron expression) and `series_id`
# grouping repeats. The host's src/modules/scheduling/recurrence.ts handles
# dispatch via host-sweep.
#
# This script finds the dev-agent session and manipulates its recurring
# message(s). It assumes the dev agent has exactly one recurring task (the
# overnight loop). If there's more than one, update SERIES_FILTER below.
#
# Usage: overnight-loop.sh {status|pause|resume|delete}
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$REPO_ROOT/data}"
CENTRAL_DB="${NANOCLAW_DB:-$DATA_DIR/v2.db}"
AGENT_FOLDER="${DEV_AGENT_FOLDER:-dev-agent}"

# Optional: tighten the series match with a LIKE pattern against content.
# When the dev agent scheduled the overnight loop, the stored message
# content probably includes the word "TASKS.md" or "overnight" — adjust
# this pattern if it matches more than one series.
SERIES_FILTER="${SERIES_FILTER:-%overnight%}"

if [ ! -f "$CENTRAL_DB" ]; then
  echo "Error: central DB not found at $CENTRAL_DB" >&2
  exit 1
fi

# Find the agent_group_id for the dev agent
AGENT_GROUP_ID=$(sqlite3 "$CENTRAL_DB" \
  "SELECT id FROM agent_groups WHERE folder='$AGENT_FOLDER' LIMIT 1")

if [ -z "$AGENT_GROUP_ID" ]; then
  echo "Error: no agent_group with folder='$AGENT_FOLDER'. Has the dev agent been registered?" >&2
  echo "       Run: scripts/setup-dev-agent.sh" >&2
  exit 1
fi

# Find session(s) for this agent — shared session_mode means usually one
SESSION_IDS=$(sqlite3 "$CENTRAL_DB" \
  "SELECT id FROM sessions WHERE agent_group_id='$AGENT_GROUP_ID' AND status='active'")

if [ -z "$SESSION_IDS" ]; then
  echo "Error: no active session for dev-agent." >&2
  echo "       The session is created the first time a message arrives in the wired channel." >&2
  echo "       Send a message in the Argos Dev Telegram chat to initialize it." >&2
  exit 1
fi

# Process each active session (usually one)
for SESSION_ID in $SESSION_IDS; do
  INBOUND_DB="$DATA_DIR/v2-sessions/$SESSION_ID/inbound.db"
  if [ ! -f "$INBOUND_DB" ]; then
    echo "[warn] inbound.db missing at $INBOUND_DB — skipping" >&2
    continue
  fi

  case "${1:-status}" in
    status)
      echo "--- session $SESSION_ID ---"
      sqlite3 -header -column "$INBOUND_DB" \
        "SELECT series_id, status, recurrence, process_after, timestamp, substr(content, 1, 60) AS content_preview
           FROM messages_in
          WHERE recurrence IS NOT NULL
            AND content LIKE '$SERIES_FILTER'
          ORDER BY timestamp DESC"
      ;;
    pause)
      CHANGES=$(sqlite3 "$INBOUND_DB" \
        "UPDATE messages_in SET status='paused'
          WHERE recurrence IS NOT NULL
            AND status='pending'
            AND content LIKE '$SERIES_FILTER';
         SELECT changes();")
      echo "[$SESSION_ID] paused $CHANGES row(s)"
      ;;
    resume)
      CHANGES=$(sqlite3 "$INBOUND_DB" \
        "UPDATE messages_in SET status='pending', process_after=datetime('now')
          WHERE recurrence IS NOT NULL
            AND status='paused'
            AND content LIKE '$SERIES_FILTER';
         SELECT changes();")
      echo "[$SESSION_ID] resumed $CHANGES row(s)"
      ;;
    delete)
      CHANGES=$(sqlite3 "$INBOUND_DB" \
        "DELETE FROM messages_in
          WHERE recurrence IS NOT NULL
            AND content LIKE '$SERIES_FILTER';
         SELECT changes();")
      echo "[$SESSION_ID] deleted $CHANGES row(s)"
      ;;
    *)
      echo "usage: $0 {status|pause|resume|delete}" >&2
      exit 2
      ;;
  esac
done
