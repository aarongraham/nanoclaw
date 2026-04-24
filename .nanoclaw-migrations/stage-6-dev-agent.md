# Stage 6 — Dev Agent (Argos) + Overnight Loop

Goal: port the specialized Elixir/Erlang dev agent that runs Claude Code against the Argos project, controlled via Telegram, on a recurring schedule.

Prerequisites:
- Stage 2 done (`/add-telegram` installed)
- Stage 4 done (first agent wired up — gives us an example of v2 agent_group schema)
- `GITHUB_TOKEN` set in `.env` with Contents read+write scoped to github.com/aarongraham/argos
- `DEV_AGENT_TELEGRAM_CHAT_ID` set in `.env` (Telegram chat ID where the dev agent replies)
- OneCLI Postgres running (`onecli-postgres-1` container, reachable via `docker exec`)
- `/opt/argos` clone writable by the user

## 6.1 Copy the dev-agent Dockerfile and build script

Both copy verbatim — no v2 incompatibilities.

```bash
cp "$PROJECT_ROOT/container/Dockerfile.dev-agent"  "$WORKTREE/container/Dockerfile.dev-agent"
cp "$PROJECT_ROOT/container/build-dev-agent.sh"    "$WORKTREE/container/build-dev-agent.sh"
chmod +x "$WORKTREE/container/build-dev-agent.sh"
```

Contents (reference, for regeneration if the source file is lost):

**`container/Dockerfile.dev-agent`** extends `nanoclaw-agent:latest` with:
- `build-essential`, `autoconf`, `libncurses5-dev`, `libssl-dev`, `libssh-dev`, `unzip` (build deps for Erlang)
- asdf v0.15.0 at `/opt/asdf`
- Erlang + Elixir plugins, installed via asdf
- `KERL_BUILD_BACKEND=tarball` for faster Erlang source download
- `KERL_CONFIGURE_OPTIONS="--disable-debug --without-javac --without-wx --without-odbc --disable-hipe"` to keep the Erlang build lean
- Global hex/rebar at `MIX_HOME=/opt/mix`
- Git identity: `nanoclaw-dev-agent@saturn.local`
- Pre-scanned GitHub SSH host key at `/home/node/.ssh/known_hosts`

**`container/build-dev-agent.sh`**:
- Reads `/opt/argos/.tool-versions` for Erlang + Elixir versions
- Runs `docker build -f Dockerfile.dev-agent` with the right build args
- Tags output as `nanoclaw-dev-agent:latest`

## 6.2 Adapt setup-dev-agent.sh

**Source**: `$PROJECT_ROOT/scripts/setup-dev-agent.sh`.

Most of it is verbatim — the steps that don't care about NanoClaw's schema:

- **Step 1** (clone Argos to `/opt/argos` with GITHUB_TOKEN embedded in `.git/config`): verbatim
- **Step 2** (git remote with credentials): verbatim
- **Step 3** (create `argos` user + `argos_dev` DB in `onecli-postgres-1`): verbatim
- **Step 4** (create `~/.config/nanoclaw/mount-allowlist.json`): **check** — v2 has a `/manage-mounts` skill for this. Either keep the script's direct JSON write, or defer to the skill. The file location is the same; either approach works.
- **Step 5** (invoke `container/build-dev-agent.sh`): verbatim
- **Step 6** (call `register-dev-agent.ts`): needs the v2 rewrite from 6.3 below

Copy setup-dev-agent.sh to the worktree and update Step 6 to call the rewritten register script:

```bash
cp "$PROJECT_ROOT/scripts/setup-dev-agent.sh" "$WORKTREE/scripts/setup-dev-agent.sh"
chmod +x "$WORKTREE/scripts/setup-dev-agent.sh"
# Edit to swap the register-dev-agent.ts invocation for the v2 version if it uses a different path/name
```

## 6.3 Rewrite register-dev-agent.ts for v2 schema

**v1 approach** (`$PROJECT_ROOT/scripts/register-dev-agent.ts`): imports `setRegisteredGroup` from `src/db.js`, constructs a v1 `RegisteredGroup` object with `containerConfig`, `isolateMemory`, `additionalMounts`, and calls one function.

**v2 approach**: insert into `agent_groups` table directly, or use v2's equivalent helper (check `src/db/agent_groups.ts` for `createAgentGroup` / `setAgentGroup`). Also insert into `messaging_groups` + `messaging_group_agents` to wire the Telegram chat to this agent group.

New file `$WORKTREE/scripts/register-dev-agent.ts`:

```ts
// Replaces v1's register-dev-agent.ts. Creates an agent group for Argos and
// wires the Telegram chat to it.
//
// Run: pnpm exec tsx scripts/register-dev-agent.ts <telegram_chat_id>

import { createAgentGroup } from '../src/db/agent-groups';
import { createMessagingGroup, linkAgentToMessagingGroup } from '../src/db/messaging-groups';

const telegramChatId = process.argv[2];
if (!telegramChatId) {
  console.error('Usage: register-dev-agent.ts <telegram_chat_id>');
  process.exit(1);
}

// 1. Agent group — holds the container config + persona
const agentGroupId = createAgentGroup({
  name: 'Argos Dev Agent',
  workspace: 'dev-agent',
  memory_isolated: true, // equivalent of v1's isolateMemory
  container_config: {
    image: 'nanoclaw-dev-agent:latest',
    timeout_ms: 30 * 60 * 1000, // 30 minutes
    additional_mounts: [
      {
        host_path: '/opt/argos',
        container_path: '/workspace/extra/argos',
        readonly: false,
      },
    ],
  },
  // No trigger word — respond to everything in wired channels
  requires_trigger: false,
});

// 2. Messaging group — the Telegram chat
const messagingGroupId = createMessagingGroup({
  channel_type: 'telegram',
  channel_chat_id: telegramChatId,
  unknown_sender_policy: 'reject',
});

// 3. Wire them — one-to-one for dev agent (not shared with other agents)
linkAgentToMessagingGroup(agentGroupId, messagingGroupId, {
  session_mode: 'one-session-per-thread',
  priority: 100,
});

console.log(`Dev agent registered. agent_group=${agentGroupId}, messaging_group=${messagingGroupId}`);
```

**This is a placeholder** — the exact function names, argument shapes, and table columns depend on v2's actual `src/db/agent-groups.ts` / `src/db/messaging-groups.ts` signatures. **Read those files first** and adjust:

```bash
cat "$WORKTREE/src/db/agent-groups.ts" | head -80
cat "$WORKTREE/src/db/messaging-groups.ts" | head -80
```

Then rewrite the body above to match the real APIs.

## 6.4 Rewrite overnight-loop.sh for v2 schedule mechanism

**v1 approach** (`$PROJECT_ROOT/scripts/overnight-loop.sh`): manipulates a row in v1's `scheduled_tasks` table in `store/messages.db` via inline `node -e` one-liners.

**v2 approach**: v2 has no `scheduled_tasks` table. Recurrence is handled by `host-sweep.ts` processing `schedule` actions in `outbound.db`, or via a central-DB `recurrence` record (check v2's actual mechanism).

Verify the v2 schedule model first:

```bash
grep -rn "schedule\|recurrence" "$WORKTREE/src/host-sweep.ts" "$WORKTREE/src/delivery.ts" "$WORKTREE/src/db/"
```

Likely location: a table like `scheduled_actions` or `recurrences` in `data/v2.db`. Find the one the dev agent would have created when it called the container-side `schedule` MCP tool.

New `$WORKTREE/scripts/overnight-loop.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Control CLI for the overnight-dev-loop recurrence.
# v2 schedule mechanism: queries the central v2 DB for the dev-agent's recurring schedule row.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${NANOCLAW_DB:-$REPO_ROOT/data/v2.db}"
# AGENT_GROUP is the id of "Argos Dev Agent" agent_group
AGENT_GROUP="${AGENT_GROUP:-dev-agent}"
# The action_type / description that identifies this specific recurrence
LOOP_MARKER="overnight-dev-loop"

run_sqlite() { sqlite3 "$DB" "$@"; }

case "${1:-status}" in
  status)
    # Replace <recurrences_table> and column names with what v2 actually uses.
    run_sqlite "SELECT id, status, next_run_at, last_run_at FROM <recurrences_table>
                WHERE agent_group_id='$AGENT_GROUP' AND description LIKE '%$LOOP_MARKER%'"
    ;;
  pause)
    run_sqlite "UPDATE <recurrences_table> SET status='paused'
                WHERE agent_group_id='$AGENT_GROUP' AND description LIKE '%$LOOP_MARKER%'"
    ;;
  resume)
    run_sqlite "UPDATE <recurrences_table> SET status='active', next_run_at=datetime('now')
                WHERE agent_group_id='$AGENT_GROUP' AND description LIKE '%$LOOP_MARKER%'"
    ;;
  delete)
    run_sqlite "DELETE FROM <recurrences_table>
                WHERE agent_group_id='$AGENT_GROUP' AND description LIKE '%$LOOP_MARKER%'"
    ;;
  *)
    echo "usage: $0 {status|pause|resume|delete}" >&2
    exit 1
    ;;
esac
```

**TODO at migration time**: replace `<recurrences_table>` and the column names with v2's real table + columns. The script's external interface (`status|pause|resume|delete`) is preserved so the user's workflow is unchanged.

## 6.5 Initial scheduling of the overnight loop

Once the dev-agent group is registered (6.3) and the container is running, the dev agent itself schedules the recurrence by calling the container-side `schedule` MCP tool with a prompt like:

> "Schedule a recurring task every 35 minutes with the prompt: 'Check TASKS.md for the next item to work on; if empty fall back to the CSV queue. Work the item, commit, deploy via Disco.'"

The container writes a `schedule` action to `outbound.db`; the host creates the recurrence row; the overnight loop is live.

The user has already done this once on v1 (per user memory: "scheduled task every 35 min; works TASKS.md then CSV fallback"). After migration, the user needs to re-issue this instruction to the dev agent (or script it) so the v2 recurrence row gets created.

## 6.6 Verification

After this stage:

- `./container/build-dev-agent.sh` succeeds (slow first time — compiles Erlang)
- `docker images | grep nanoclaw-dev-agent` shows the built image
- `./scripts/setup-dev-agent.sh` runs without errors
- `sqlite3 data/v2.db "SELECT * FROM agent_groups WHERE workspace='dev-agent'"` returns one row
- Send a Telegram message from `DEV_AGENT_TELEGRAM_CHAT_ID` → dev agent responds with Argos project context
- After scheduling the loop via the dev agent itself, `./scripts/overnight-loop.sh status` returns an active recurrence
- 35 minutes later (or trigger via `resume`), the loop runs and produces a commit or a status message

## Done

All stages are complete. Return to Phase 2 step 2.6 (validate) → 2.7 (live test) → 2.8 (swap).
