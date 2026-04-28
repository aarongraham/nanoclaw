---
name: install-new-device-intake
description: One-time installer for the new-device-intake feature on this NanoClaw installation. Idempotent. Patches dm-with-aaron's container.json + CLAUDE.local.md, initializes the ledger, rebuilds the container image, and registers the recurring scheduled task that drives intake polling. Invoke with /install-new-device-intake.
---

# /install-new-device-intake

Sets up the new-device-intake feature on this NanoClaw installation. Run from inside `claw.home.lan` (where the NanoClaw host process lives). Safe to re-run — every step is idempotent.

The installed feature uses the **dm-with-aaron** agent group: it polls NetAlertX every 5 minutes, and if a qualifying new device is found, sends Aaron a Telegram ping in his existing DM. Aaron's reply is parsed and applied to NetAlertX + Pi-hole.

## What this installer does

1. **Preflight** — confirm NetAlertX + Pi-hole are reachable and Pi-hole has groups 0-3.
2. **Patch `groups/dm-with-aaron/container.json`** — add `python3-minimal` and `sqlite3` to `packages.apt` so the agent container can run the intake skill's helpers.
3. **Append a sentinel section to `groups/dm-with-aaron/CLAUDE.local.md`** — instructs the agent to check the intake ledger on every Telegram DM wake, so reply messages are routed to the new-device-intake skill instead of being treated as casual chat.
4. **Initialize the ledger** at `groups/dm-with-aaron/data/new-device-intake.db`.
5. **Rebuild the dm-with-aaron container image** so the apt packages are baked in.
6. **Register a recurring scheduled task** (cron `*/5 * * * *`) on dm-with-aaron's session that runs the intake poll script.
7. **Persist the task ID** in the ledger's `meta` table so re-running the installer updates the existing task instead of creating duplicates.

## Steps

### 1. Run preflight

```bash
cd ~/projects/nanoclaw
python3 .claude/skills/install-new-device-intake/preflight.py
```

If it exits non-zero, stop and report the failures. Common fixes:
- `NETALERTX_API_TOKEN` not set → add it to `~/projects/nanoclaw/.env` (same token saturn's `/opt/docker/scripts/netalertx_rename.py` uses).
- Pi-hole missing groups → check the Pi-hole admin UI, ensure groups 0–3 exist with the canonical names.

### 2. Patch `groups/dm-with-aaron/container.json`

Read the current file:
```bash
cat groups/dm-with-aaron/container.json
```

Edit it to add `python3-minimal` and `sqlite3` to `packages.apt` (preserve every other field). Also pass through the NetAlertX env var so the agent and its scheduled-task scripts can read it. The merged `packages` and `envPassthrough` should look like:

```json
{
  "...other fields...": "...",
  "packages": {
    "apt": ["python3-minimal", "sqlite3"],
    "npm": []
  },
  "envPassthrough": ["NETALERTX_API_TOKEN"]
}
```

If `envPassthrough` already exists, **add** `"NETALERTX_API_TOKEN"` to it without removing existing entries. If `packages.apt` already contains values, merge — don't replace.

**Idempotency:** check if both packages are already present and skip the write if so.

### 3. Append the ledger-check sentinel to `groups/dm-with-aaron/CLAUDE.local.md`

Look for the sentinel marker `<!-- new-device-intake:v1 -->` in the file. If present, this step is already done — skip.

Otherwise, append this block (preserving any existing content):

```markdown
<!-- new-device-intake:v1 -->
## New-device intake (auto-installed)

On every wake to handle a Telegram DM from Aaron, **first** check the intake ledger before treating the message as casual chat:

```bash
sqlite3 /workspace/agent/data/new-device-intake.db \
  "SELECT mac FROM intake WHERE pending=1;"
```

If a row is returned, the inbound message is a reply to a pending intake ping. Follow `/home/node/.claude/skills/new-device-intake/SKILL.md` reply branch. Otherwise proceed normally.
<!-- /new-device-intake:v1 -->
```

### 4. Initialize the ledger

```bash
python3 .claude/skills/install-new-device-intake/init_ledger.py
```

Creates `groups/dm-with-aaron/data/new-device-intake.db` with the `intake` and `meta` tables. Reusing an existing DB is a no-op.

### 5. Rebuild the dm-with-aaron container image

The container.json change in step 2 means the next spawn needs a fresh image with the apt packages installed. Trigger a rebuild:

```bash
./container/build.sh
```

(Or whatever the current per-group rebuild command is — `container/build.sh` is the canonical entry point as of this writing.)

### 6. Register the recurring scheduled task

Use the `mcp__nanoclaw__schedule_task` MCP tool. The task targets dm-with-aaron's existing session — that session is created the first time Aaron messages the agent, so confirm a session row exists:

```bash
python3 -c "
import sqlite3
c = sqlite3.connect('data/v2.db')
ag = c.execute(\"SELECT id FROM agent_groups WHERE folder='dm-with-aaron'\").fetchone()
if not ag:
    print('ERROR: dm-with-aaron agent_group missing')
    raise SystemExit(2)
sess = c.execute('SELECT id FROM sessions WHERE agent_group_id=? AND status=\"active\"', ag).fetchone()
print('agent_group:', ag[0], 'session:', sess[0] if sess else 'NONE')
"
```

If session is `NONE`, send a message to the dm-with-aaron Telegram chat first to create one, then re-run.

Check for an existing scheduled task to update in place:
```bash
sqlite3 groups/dm-with-aaron/data/new-device-intake.db \
  "SELECT value FROM meta WHERE key='schedule_task_id';"
```

If a row is returned: call `mcp__nanoclaw__update_task` with that ID. Otherwise call `mcp__nanoclaw__schedule_task`. Fields:

- `prompt`: `An unlabeled new device was detected on the home network. Use the new-device-intake skill at /home/node/.claude/skills/new-device-intake/ and follow the "Initial wake" branch of its SKILL.md. The device data is in your wake context.`
- `recurrence`: `*/5 * * * *`
- `script`: `python3 /home/node/.claude/skills/new-device-intake/poll.py`
- `processAfter`: current local timestamp ISO 8601 (e.g. `2026-04-27T15:00:00`) — V2 interprets naive timestamps in the user's timezone.

Capture the returned task ID.

### 7. Persist the task ID

```bash
sqlite3 groups/dm-with-aaron/data/new-device-intake.db \
  "INSERT INTO meta(key,value) VALUES('schedule_task_id','<TASK_ID>')
   ON CONFLICT(key) DO UPDATE SET value=excluded.value;"
```

### 8. Print summary

Report back:

```
✅ new-device-intake installed
   agent_group:       dm-with-aaron
   scheduled task ID: <TASK_ID>
   recurrence:        */5 * * * *
   ledger:            groups/dm-with-aaron/data/new-device-intake.db
   log (in-container): /workspace/agent/logs/new-device-intake.log
```

## Post-install sanity check

Run the poller manually in dry-run mode to confirm wiring:

```bash
NETALERTX_API_TOKEN="$(grep NETALERTX_API_TOKEN .env | cut -d= -f2)" \
  python3 container/skills/new-device-intake/poll.py \
  --dry-run \
  --ledger /tmp/intake-dry.db \
  --log /tmp/intake-dry.log \
&& cat /tmp/intake-dry.log
```

Expected stdout: `{"wakeAgent": false}` (nothing qualifying right now) or a wake payload if a real new device happens to qualify. Either is fine — the test is "valid JSON, exit 0".

## Uninstall

```bash
# Cancel the scheduled task
mcp__nanoclaw__cancel_task <TASK_ID>

# Remove ledger
rm -f groups/dm-with-aaron/data/new-device-intake.db

# Remove the CLAUDE.local.md sentinel block (and the surrounding markers)
# Manual edit — search for "<!-- new-device-intake:v1 -->" in
# groups/dm-with-aaron/CLAUDE.local.md and delete from that line through
# the matching "<!-- /new-device-intake:v1 -->" line.

# Optional: remove python3-minimal/sqlite3 from container.json's packages.apt
# and rebuild the image.
```
