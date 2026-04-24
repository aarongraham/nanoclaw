---
name: install-new-device-intake
description: One-time installer for the new-device-intake feature. Idempotent. Runs preflight checks, initializes the ledger DB, and registers the recurring scheduled task that drives the feature. Invoke with /install-new-device-intake.
---

# /install-new-device-intake

Sets up the new-device-intake feature on this NanoClaw installation. Safe to re-run.

## Steps

### 1. Run preflight

```bash
cd /home/aaron/projects/nanoclaw/.claude/skills/install-new-device-intake
python3 preflight.py
```

Exits non-zero with failure list if anything's missing: `sqlite3` not on PATH, `NETALERTX_API_TOKEN` unset in the environment, NetAlertX unreachable, or Pi-hole missing any of groups 0–3. Stop here if preflight fails — fix the reported issue(s) and re-run.

### 2. Initialize the ledger

```bash
python3 /home/aaron/projects/nanoclaw/.claude/skills/install-new-device-intake/init_ledger.py
```

Creates `/home/aaron/projects/nanoclaw/data/new-device-intake.db` with the `intake` and `meta` tables if it doesn't exist. Idempotent — reusing an existing ledger is fine.

### 3. Resolve the telegram_main JID

Find the Telegram chat ID wired to the `telegram_main` messaging group. The exact DB path and schema depends on NanoClaw version. Inspect the `data/` directory:

```bash
ls /home/aaron/projects/nanoclaw/data/*.db
```

Then query for the `telegram_main` messaging group's platform ID:

```bash
sqlite3 /home/aaron/projects/nanoclaw/data/<nanoclaw-db>.db \
  "SELECT platform_id FROM messaging_groups WHERE name='telegram_main' LIMIT 1;"
```

(If the table or column name differs, use `.schema` to find the right one.) Save the result as `TELEGRAM_MAIN_JID` — expect a string like `tg:-100xxxxxxxxxx` or `tg:xxxxxxxxxx`.

### 4. Check for an existing scheduled task

```bash
sqlite3 /home/aaron/projects/nanoclaw/data/new-device-intake.db \
  "SELECT value FROM meta WHERE key='schedule_task_id';"
```

- If a row is returned: there's already a task registered. Use `update_task` MCP tool with the stored ID to refresh its fields.
- Otherwise: use `schedule_task` MCP tool to create a new task.

### 5. Register (or update) the scheduled task

Call the `schedule_task` / `update_task` MCP tool with:

- `prompt`: `A new unlabeled device was detected on the home network. Use the new-device-intake skill and follow handle.md. The telegram_main JID is <TELEGRAM_MAIN_JID>.`
- `recurrence`: `*/5 * * * *`
- `script`: `/home/aaron/projects/nanoclaw/.claude/skills/new-device-intake/poll.py`
- `process_after`: current UTC time in ISO 8601 (e.g. `2026-04-23T15:00:00Z`)

Capture the returned task ID.

### 6. Persist the task ID in the ledger's meta table

```bash
sqlite3 /home/aaron/projects/nanoclaw/data/new-device-intake.db \
  "INSERT INTO meta(key,value) VALUES('schedule_task_id','<TASK_ID>')
   ON CONFLICT(key) DO UPDATE SET value=excluded.value;"
```

### 7. Print summary

Report back:

```
✅ new-device-intake installed
   scheduled task ID: <TASK_ID>
   next fire:         <process_after>
   ledger:            /home/aaron/projects/nanoclaw/data/new-device-intake.db
   log:               /home/aaron/projects/nanoclaw/logs/new-device-intake.log
```

## Post-install sanity check (optional)

Run the poller manually in dry-run mode and confirm it emits valid JSON without writing to the ledger:

```bash
NETALERTX_API_TOKEN="<token>" python3 \
  /home/aaron/projects/nanoclaw/.claude/skills/new-device-intake/poll.py \
  --dry-run \
  --ledger /tmp/intake-dry.db \
  --log /tmp/intake-dry.log
```

Expected stdout: `{"wakeAgent": false}` (nothing qualifying right now), or `{"wakeAgent": true, "data": {"device": {...}}}` if a real new device happens to qualify at this moment. Either is fine — the important thing is valid JSON and exit 0.
