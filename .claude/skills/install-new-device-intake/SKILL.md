---
name: install-new-device-intake
description: One-time installer for the new-device-intake feature. Idempotent. Builds the dm-with-aaron per-group image with python3+sqlite3 layered, inserts the recurring schedule_task that polls NetAlertX every 5 minutes, and persists the task ID in the intake ledger. Invoke with /install-new-device-intake.
---

# /install-new-device-intake

Sets up the new-device-intake feature on this NanoClaw installation. Run from the NanoClaw host (where the host process lives). Idempotent — safe to re-run.

The feature uses the **dm-with-aaron** agent group: it polls NetAlertX every 5 minutes via a scheduled task, and when a qualifying new unlabeled device is found it pings Aaron in his existing Telegram DM. Aaron's reply is parsed and applied to NetAlertX (with `devName` locked) + Pi-hole (correct blocking group).

## Steps

### 1. Verify prerequisites

```bash
cd ~/projects/nanoclaw

# A) NetAlertX reachable + token valid
python3 .claude/skills/install-new-device-intake/preflight.py
# → should print "preflight: all checks passed"

# B) NETALERTX_API_TOKEN in nanoclaw .env
grep -q '^NETALERTX_API_TOKEN=' .env || echo "MISSING: add NETALERTX_API_TOKEN to .env"
# Source the value from saturn:
#   ssh aaron@192.168.42.11 "grep '^API_TOKEN=' /opt/docker/appdata/netalertx/data/config/app.conf"
# Then add to ~/projects/nanoclaw/.env as:
#   NETALERTX_API_TOKEN=<that value>
```

### 2. Patch `groups/dm-with-aaron/container.json`

The agent container needs `python3-minimal` + `sqlite3` (so poll.py and the agent's ledger lookups work) and `NETALERTX_API_TOKEN` passed through from `.env`.

Read the current file:
```bash
cat groups/dm-with-aaron/container.json
```

Edit it to merge in these fields (preserve every other field, including `imageTag`, `additionalMounts`, etc.):

```json
{
  "packages": {
    "apt": ["python3-minimal", "sqlite3"],
    "npm": []
  },
  "envPassthrough": ["NETALERTX_API_TOKEN"]
}
```

If `packages.apt` already contains values, **merge** rather than replace. If `envPassthrough` already exists, append `"NETALERTX_API_TOKEN"` without removing existing entries.

**Idempotency:** if both packages and the env var are already present, skip the write.

### 3. Append the ledger-check sentinel to `groups/dm-with-aaron/CLAUDE.local.md`

Look for the marker `<!-- new-device-intake:v1 -->` in the file. If present, skip this step.

Otherwise, append:

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

### 4. Run the installer script

```bash
pnpm exec tsx scripts/install-new-device-intake.ts
```

This is the canonical install entry point. It:

- Builds the per-agent-group container image via `buildAgentGroupImage` (so `packages.apt` is layered on the base — `./container/build.sh` only handles the base image)
- Verifies `python3` and `sqlite3` are present in the built image
- Inserts (or updates) the recurring `schedule_task` row directly in the Telegram session's `inbound.db` via `insertTask` / `updateTask` from `src/modules/scheduling/db.ts`
- Persists the task ID in `groups/dm-with-aaron/data/new-device-intake.db`'s `meta` table

The ledger DB is auto-created if missing. The agent container will respawn on the next wake to pick up the new image.

### 5. Verify

```bash
# Scheduled task registered
sqlite3 groups/dm-with-aaron/data/new-device-intake.db \
  "SELECT * FROM meta WHERE key='schedule_task_id';"

# Image has python3 + sqlite3
docker run --rm --entrypoint /bin/bash \
  $(python3 -c "import json; print(json.load(open('groups/dm-with-aaron/container.json'))['imageTag'])") \
  -c 'python3 --version && sqlite3 --version'

# Wait 5 min, then check the poll log
tail -3 groups/dm-with-aaron/logs/new-device-intake.log
# Expect "candidates=0 -- no device to ping" (or a real candidate).
# If you see "NETALERTX_API_TOKEN is empty; cannot poll", the running
# container was spawned before the envPassthrough wiring landed —
# kill it and let it respawn:
#   docker rm -f $(docker ps -q --filter "name=dm-with-aaron")
```

## Dry-run sanity check (optional)

Run the poller manually in dry-run mode against the host's `.env`:

```bash
NETALERTX_API_TOKEN="$(grep ^NETALERTX_API_TOKEN= .env | cut -d= -f2-)" \
  python3 container/skills/new-device-intake/poll.py \
  --dry-run \
  --ledger /tmp/intake-dry.db \
  --log /tmp/intake-dry.log \
&& cat /tmp/intake-dry.log
```

Expected stdout: `{"wakeAgent": false}` (nothing qualifying right now) or a wake payload if a real new device qualifies. Either is fine — the test is "valid JSON, exit 0".

## Uninstall

```bash
# 1. Cancel the scheduled task
TASK_ID=$(sqlite3 groups/dm-with-aaron/data/new-device-intake.db \
  "SELECT value FROM meta WHERE key='schedule_task_id';")
SESS_DIR=$(echo data/v2-sessions/ag-*-*/sess-*-*)
sqlite3 "$SESS_DIR/inbound.db" \
  "UPDATE messages_in SET status='cancelled' WHERE id='$TASK_ID';"

# 2. Remove ledger
rm -f groups/dm-with-aaron/data/new-device-intake.db

# 3. Remove the CLAUDE.local.md sentinel block (manual edit — search for
#    "<!-- new-device-intake:v1 -->" through "<!-- /new-device-intake:v1 -->")

# 4. Optional: remove python3-minimal/sqlite3 from container.json's
#    packages.apt and rebuild the per-group image.
```
