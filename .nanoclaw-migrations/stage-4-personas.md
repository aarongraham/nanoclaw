# Stage 4 — Agent Personas

Goal: bring the user's agent persona definitions (`groups/global/CLAUDE.md` + `groups/main/CLAUDE.md`) into v2, adapting path references that were hardcoded to v1's IPC layout.

These files define the "Claw" persona: direct, dry-humoured, efficient, with a capabilities list (web, Seerr, Home Assistant, bash, file I/O, task scheduling) and formatting rules per channel.

## 4.1 groups/global/CLAUDE.md

**Source**: `$PROJECT_ROOT/groups/global/CLAUDE.md` (166 lines).

**Approach**: copy content, then apply targeted path updates.

```bash
mkdir -p "$WORKTREE/groups/global"
cp "$PROJECT_ROOT/groups/global/CLAUDE.md" "$WORKTREE/groups/global/CLAUDE.md"
```

Then hand-edit for v2 path changes. Look for references to:

| v1 reference | v2 equivalent |
|---|---|
| `/workspace/ipc/available_groups.json` | Query central DB: `sqlite3 /workspace/data/v2.db "SELECT * FROM agent_groups"` (exact command depends on v2's mount layout — verify path inside container) |
| `/workspace/ipc/tasks/` | v2's schedule mechanism: write a `schedule` action to `outbound.db` via the container MCP tool |
| `/workspace/project/store/messages.db` | Per-session DBs under `/workspace/data/v2-sessions/<session_id>/`; or central DB at `/workspace/data/v2.db` depending on what the query needs |
| `register_group` MCP tool | v2 has its own agent-group management MCP tools — check what's registered: `grep -r "mcp-tools" container/agent-runner/src/` |

The persona section (personality traits, "direct, dry humour, efficient", etc.) is content — preserve verbatim.

The capabilities section — preserve. The tools listed (web fetch, agent-browser, Seerr, Home Assistant, bash, file I/O) are all still valid in v2.

The memory section — v2 preserves `/workspace/shared/` semantics but scoped per agent-group, not per linked channel. The `people.md` pattern works the same way.

The formatting rules section (Slack mrkdwn, WhatsApp/Telegram, Discord) — v2's `/add-slack-channel-formatting` skill may handle this automatically; check if v2 still needs the rules embedded in CLAUDE.md or if the channel adapter formats output. Preserve the content either way; it's not harmful.

## 4.2 groups/main/CLAUDE.md

**Source**: `$PROJECT_ROOT/groups/main/CLAUDE.md` (243 lines).

**Approach**: copy content, rewrite group-management and task-scheduling sections for v2.

```bash
mkdir -p "$WORKTREE/groups/main"
cp "$PROJECT_ROOT/groups/main/CLAUDE.md" "$WORKTREE/groups/main/CLAUDE.md"
```

Then edit. The sections needing rewrites:

### Auth/OneCLI section

The user has a detailed section about Anthropic auth (API key vs OAuth token, OneCLI credential injection, short-lived token issues). This stays valid in v2 — preserve.

**One change**: the v1 text may reference `src/credential-proxy.ts` or the credential-proxy port. In v2, credential handling is pure OneCLI through the gateway; remove any reference to the proxy being a separate v1 component. The port (`CREDENTIAL_PROXY_PORT=3001`) is still meaningful in v2 — it's how containers reach the OneCLI gateway.

### Container mounts section

v1 text mentions: read-only `/workspace/project`, read-write `/workspace/group` + `/workspace/shared`.

v2 preserves this layout per session. Update any specifics that reference v1 IPC paths:
- Remove `/workspace/ipc/` mount description (IPC directory does not exist in v2)
- Add (if missing): `/workspace/data/` (session DBs mounted read-only; container writes only to its session's `outbound.db`)

### Group management section

v1 text tells the agent how to manage agent groups — reads `/workspace/ipc/available_groups.json`, uses `register_group` MCP tool, writes to `/workspace/project/data/registered_groups.json`.

**Rewrite for v2**: the agent manages groups by:
- Reading from central DB: `sqlite3 /workspace/data/v2.db "SELECT id, name, kind, workspace FROM agent_groups"`
- Using v2's agent-group MCP tools (name them once confirmed by grep of v2's container/agent-runner/src/mcp-tools/)
- Sender allowlist: v2 may handle this via `user_roles` table + `messaging_groups.unknown_sender_policy` — check v2's docs/isolation-model.md

Replace the v1 JSON-file references with DB queries. Keep the structure of the section (what groups look like, how to add one, sender allowlist) — just update the mechanism.

### Task scheduling section

v1 text describes scheduling tasks for "this group" vs "other groups" using the IPC task directory.

**Rewrite for v2**: tasks become scheduled actions via the v2 schedule mechanism. The container writes a `schedule` action to its `outbound.db`, which `host-sweep.ts` processes and creates a recurrence record. Cross-group scheduling (`target_group_jid` parameter in v1) maps to v2's messaging_group routing.

### Sender allowlist section

v1 references `~/.config/nanoclaw/sender-allowlist.json`. v2 may move this into the central DB. Check `src/modules/permissions/` and `src/db/migrations/` for the v2 representation. Update the section accordingly.

## 4.3 Wire the personas to messaging groups

After the files are in place:

```bash
cd "$WORKTREE"
/init-first-agent
```

This v2 skill walks through:
- Picking a channel (Telegram or WhatsApp — both installed in Stage 2)
- Resolving the operator's channel identity
- Wiring the DM messaging group to a new agent group
- Sending a welcome DM

The agent group gets the `groups/main/CLAUDE.md` content (or wherever `/init-first-agent` points it). The `groups/global/CLAUDE.md` is shared across all agent groups via v2's CLAUDE.md composition (`src/claude-md-compose.ts`).

If the user wants a specific name/folder/persona for the main agent, pass those during `/init-first-agent`'s prompts.

## Verification

After this stage:

- Central DB should have at least one row in `agent_groups` and one in `messaging_groups`, wired via `messaging_group_agents`.
- Send a test message from the user's real Telegram/WhatsApp DM → the agent should respond with the Claw persona voice.
- The response should follow the channel's formatting conventions (Slack mrkdwn if Slack, WhatsApp formatting if WhatsApp, etc.).

Skip to [Stage 5](stage-5-optional-features.md).
