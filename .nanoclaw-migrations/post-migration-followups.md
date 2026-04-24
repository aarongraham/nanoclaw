# Post-migration Followups

Items deferred during the auto-drive of Stages 1-5. Each is self-contained and can be tackled one at a time.

## 1. Dashboard install (BLOCKED on upstream)

The `/add-dashboard` skill on `upstream/main` references modules that exist only on `upstream/feat/per-group-provider-config` (unmerged feature branch):

- `src/db/agent-destinations.ts`
- `src/db/users.ts`
- `src/db/user-roles.ts`
- `src/db/user-dms.ts`
- `src/db/agent-group-members.ts`

**Options:**
- **Wait for upstream merge**: watch `upstream/feat/per-group-provider-config` for merge into `main`, then re-run `/add-dashboard` in the live tree.
- **Pull manually now**: `git show upstream/feat/per-group-provider-config:src/db/<file>.ts > src/db/<file>.ts` for each missing module, then run the skill. Risk: those modules depend on DB migrations and schema changes that may not be on main.
- **Skip dashboard**: leave it off. Your `DASHBOARD_ENABLED=true` in `.env` won't do anything (v2 dashboard gates on `DASHBOARD_SECRET`, which isn't set).

Package `@nanoco/nanoclaw-dashboard@0.3.0` is installed in `package.json` but unused — harmless.

## 2. WhatsApp adapter integrations (Stage 5 hookups)

`src/channel-health.ts`, `src/image.ts`, `src/transcription.ts` are ported as standalone utility modules, but **nothing calls them yet**. They need hooking into v2's `src/channels/whatsapp.ts` (installed from `upstream/channels`).

Do **not** edit `src/channels/whatsapp.ts` directly — changes will conflict on the next `/add-whatsapp` reinstall. Instead, either:

- **Fork the adapter**: rename to `src/channels/whatsapp-custom.ts`, edit the import in `src/channels/index.ts`, and maintain your version. Upstream updates become manual rebases.
- **Request upstream hooks**: open a PR against the `channels` branch adding a pluggable `onInboundTransform(msg)` hook that your modules can register against. Long-term cleanest path.

### What each module needs

- **channel-health**: in `whatsapp.ts`, add `setChannelHealth('whatsapp', 'healthy'|'degraded'|'unknown', reason)` at the three connection lifecycle points: `open`, `close` (non-loggedOut), `loggedOut`. Same for Telegram.
- **image**: in `whatsapp.ts` inbound handler, before the normal text routing, branch on `isImageMessage(msg)` → `processImage(buffer, sessionAttachmentDir, caption)` → include `[Image: ...]` in the routed message text. Note: v2's attachment dir convention is `data/v2-sessions/<session_id>/attachments/`, not v1's per-group path. May require deferring processing until after session resolution.
- **transcription**: same pattern, branch on `isVoiceMessage(msg)` → `transcribeAudioMessage(msg, sock)` → use text as message body. Requires `ffmpeg` + `whisper-cli` + model file on host (your `.env` has `WHISPER_BIN` / `WHISPER_MODEL`).
- **channel-health debounced alerts**: wire the 15-minute debounce + main-group alert into `src/index.ts` after `startHostSweep()`. Main-group resolution uses `src/user-dm.ts` in v2 (not a v1-style main JID).

## 3. Emoji reactions — status tracker + MCP tool

The `reactions` DB table and `src/db/reactions.ts` helpers are ready. The remaining pieces:

### a. Status tracker (host-side)

Port `src/status-tracker.ts` from v1 main tree, but rewrite to derive state from session DBs instead of in-memory mutation:

- 👀 received: session created in central DB → send on first routing
- 🧠 thinking: first `processing_ack` bump in `inbound.db`
- 🔄 working: first non-ack write to `outbound.db`
- ✅ done: outbound stream closed with status=done
- ❌ failed: outbound stream closed with status=failed OR container heartbeat stale beyond timeout

Implement in `src/modules/status-tracker.ts` (new file; v2 convention is one-module-per-directory under `src/modules/`). Register via `onShutdown` + subscribe to session-state changes.

Persistence disappears — session DBs are authoritative. Crash recovery is automatic.

### b. Container-side MCP tool

v1 had `mcp__nanoclaw__react_to_message` in `container/agent-runner/src/ipc-mcp-stdio.ts`. v2 has no `ipc-mcp-stdio.ts`.

Create `container/agent-runner/src/mcp-tools/react-to-message.ts` following the pattern of existing MCP tools (`self-mod.ts` or whichever v2 uses). The tool should write a `reaction` action to `outbound.db`:

```sql
INSERT INTO messages_out (seq, kind, content, ...) VALUES (
  <odd-seq>,
  'reaction',
  json_object('message_id', $message_id, 'emoji', $emoji),
  ...
)
```

Then `src/delivery.ts` (host) needs a case to handle `kind = 'reaction'` actions and call the channel adapter's `sendReaction`.

### c. WhatsApp adapter `sendReaction`

Baileys supports reactions natively:

```typescript
await sock.sendMessage(chatJid, {
  react: { text: emoji, key: messageKey }
});
```

Wire this via the same fork-or-hook pattern as item 2.

### d. Container skill

Replace `container/skills/reactions/SKILL.md` (currently copied over with the v1 MCP tool name). Update to reference the new v2 tool and the central DB path for message lookups (`/workspace/data/v2.db` instead of `/workspace/project/store/messages.db`).

## 4. Dev agent + overnight loop (Stage 6)

Not done. Needs:

- Copy `container/Dockerfile.dev-agent` + `container/build-dev-agent.sh` from main tree to worktree.
- Build `nanoclaw-dev-agent-v2-<slug>:latest` (v2 uses per-install image name via `setup/lib/install-slug.sh`). Update `Dockerfile.dev-agent`'s `FROM` ARG accordingly.
- Adapt `scripts/setup-dev-agent.sh` — the step that registers the agent group needs rewriting.
- **Rewrite** `scripts/register-dev-agent.ts` against v2 schema. Read `src/db/agent-groups.ts` and `src/db/messaging-groups.ts` first to pattern-match the real API surface (v2 doesn't export `setRegisteredGroup` — the insertion goes to `agent_groups` + `messaging_groups` + `messaging_group_agents`).
- **Rewrite** `scripts/overnight-loop.sh` to operate on v2's schedule mechanism (grep `host-sweep.ts` for the exact table name and columns). Script's external interface (status/pause/resume/delete) stays the same.

Prereqs you need handy:
- `GITHUB_TOKEN` in `.env` (already there)
- `DEV_AGENT_TELEGRAM_CHAT_ID` in `.env` (already there)
- `/opt/argos` clone
- OneCLI Postgres container running (`onecli-postgres-1`)

## 5. Path updates in groups/main/CLAUDE.local.md

Your `groups/main/CLAUDE.local.md` references v1-era paths:
- `/workspace/ipc/available_groups.json`
- `/workspace/ipc/tasks/refresh_*.json`
- `/workspace/project/store/messages.db`
- `/workspace/project/data/registered_groups.json`
- `register_group` MCP tool

v2 replaces all of these with central DB queries (`/workspace/data/v2.db` with `agent_groups` / `messaging_groups` tables). Rewrite the "Managing Groups" and "Finding Available Groups" sections. v2's actual MCP tool names are in `container/agent-runner/src/mcp-tools/`.

**Note**: v2 trunk's `groups/main/CLAUDE.md` stub also has these v1 references — upstream hasn't updated them yet. The issue exists on both sides.

## 6. OneCLI re-wiring after swap

After swap into main tree:
- `onecli agents list` — find the new v2 agent IDs (they'll be different from v1's).
- For each: `onecli agents set-secret-mode --id <id> --mode all` if you want all vault secrets auto-assigned (see CLAUDE.md "auto-created agents start in selective secret mode" gotcha).

## Rollback

If anything goes wrong after swap:
```bash
git reset --hard pre-migrate-v2-15e972e-20260424-145611
```
