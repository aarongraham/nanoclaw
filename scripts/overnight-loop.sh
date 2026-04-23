#!/usr/bin/env bash
set -euo pipefail

TASK_ID="overnight-dev-loop"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${NANOCLAW_DB:-$REPO_ROOT/store/messages.db}"

run_node() {
  node -e "$1" "$DB" "$TASK_ID" "${2:-}"
}

case "${1:-status}" in
  status)
    run_node '
      const d = require("better-sqlite3")(process.argv[1], { readonly: true });
      const r = d.prepare("SELECT id, status, next_run, last_run, last_result FROM scheduled_tasks WHERE id = ?").get(process.argv[2]);
      if (!r) { console.log("task not found — has it been inserted?"); process.exit(1); }
      console.log(r);
    '
    ;;
  pause)
    run_node '
      const d = require("better-sqlite3")(process.argv[1]);
      const r = d.prepare("UPDATE scheduled_tasks SET status = ? WHERE id = ?").run("paused", process.argv[2]);
      console.log(r.changes ? "paused (in-flight runs, if any, continue to completion)" : "task not found");
    '
    ;;
  resume)
    run_node '
      const d = require("better-sqlite3")(process.argv[1]);
      const r = d.prepare("UPDATE scheduled_tasks SET status = ?, next_run = ? WHERE id = ?").run("active", new Date().toISOString(), process.argv[2]);
      console.log(r.changes ? "resumed — next run imminent" : "task not found");
    '
    ;;
  delete)
    run_node '
      const d = require("better-sqlite3")(process.argv[1]);
      const r = d.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(process.argv[2]);
      console.log(r.changes ? "deleted" : "task not found");
    '
    ;;
  *)
    echo "usage: $0 {status|pause|resume|delete}" >&2
    exit 1
    ;;
esac
