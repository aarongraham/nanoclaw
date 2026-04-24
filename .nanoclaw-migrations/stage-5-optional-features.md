# Stage 5 — Optional Features

Goal: port the four v1 features that have no v2 skill equivalent. These are custom code that must be retargeted onto v2's architecture.

Order matters. Channel health first (standalone), then image vision + voice transcription (both hook into WhatsApp adapter and are independent of each other), then emoji reactions (depends on both the adapter hookups and the container-side MCP layer — hardest).

## 5.1 Channel health + debounced alerts

**Source**: `$PROJECT_ROOT/src/channel-health.ts` — a pure utility module with an event-bus pattern.

**Port strategy**: copy verbatim to v2 at `src/channel-health.ts` or `src/modules/channel-health.ts` (check v2's modules/ convention). No v1 architecture dependencies.

### File to create

```bash
cp "$PROJECT_ROOT/src/channel-health.ts" "$WORKTREE/src/channel-health.ts"
```

The file exports:
- `type HealthState = 'healthy' | 'degraded' | 'unknown'`
- `interface ChannelHealth { channel, state, reason, since }`
- `setChannelHealth(channel, next, reason?)`
- `getChannelHealth(channel)`
- `getAllChannelHealth()`
- `onChannelHealthChange(listener)`

### Integration points (the debounced-alert behavior)

The pure health-state module above is simple. The **debounced-alert** behavior — sending a message to the main group when a channel stays degraded >15min — lives in `src/index.ts` in v1 and needs re-anchoring in v2:

- v1 wired it into `startIpcWatcher`. v2 has no IPC watcher.
- v2 equivalent: hook into `src/host-sweep.ts` or `src/delivery.ts` startup, register `onChannelHealthChange` with a debouncer, and send via the main agent group's channel adapter.

Logic to preserve (from `src/index.ts` v1):

```typescript
const CHANNEL_ALERT_DEBOUNCE_MS = Number(process.env.CHANNEL_ALERT_DEBOUNCE_MS) || 15 * 60 * 1000;
const pendingDegradedAlerts = new Map<string, NodeJS.Timeout>();
const sentDegradedAlerts = new Set<string>();

onChannelHealthChange((update, prevState) => {
  const { channel, state, reason } = update;
  if (state === 'degraded') {
    // Debounce: only alert after CHANNEL_ALERT_DEBOUNCE_MS of sustained degradation
    if (pendingDegradedAlerts.has(channel)) return;
    const timer = setTimeout(() => {
      sendAlertToMainGroup(`⚠️ ${channel} degraded: ${reason ?? 'unknown'}`);
      sentDegradedAlerts.add(channel);
      pendingDegradedAlerts.delete(channel);
    }, CHANNEL_ALERT_DEBOUNCE_MS);
    pendingDegradedAlerts.set(channel, timer);
  } else if (state === 'healthy') {
    // Clear any pending degraded alert
    const pending = pendingDegradedAlerts.get(channel);
    if (pending) { clearTimeout(pending); pendingDegradedAlerts.delete(channel); }
    // If a degraded alert was already sent, send a recovery alert
    if (sentDegradedAlerts.has(channel)) {
      sendAlertToMainGroup(`✅ ${channel} recovered`);
      sentDegradedAlerts.delete(channel);
    }
  }
});
```

In v2, `sendAlertToMainGroup` needs to resolve the main group via `getMainGroup()` (if v2 preserves the concept) or by querying `messaging_groups` for the owner's DM. Use `src/delivery.ts` primitives or the channel adapter's `send` method directly.

### Where adapters call setChannelHealth

v2's `/add-telegram` and `/add-whatsapp` skills' adapters probably don't call `setChannelHealth` natively. Add calls at the connection lifecycle hooks:

- On `connection.open`: `setChannelHealth('whatsapp', 'healthy', null)`
- On `connection.close` (non-loggedOut): `setChannelHealth('whatsapp', 'degraded', reason)`
- On logout: `setChannelHealth('whatsapp', 'unknown', 'logged out')`

Same pattern for Telegram's long-polling error / recovery events.

## 5.2 Image vision

**Source**: `$PROJECT_ROOT/src/image.ts` + corresponding changes in `container/agent-runner/src/index.ts`.

**Port strategy**: the image-processing logic (sharp resize + JPEG output + file reference in message text) ports directly. The integration with WhatsApp needs to hook into v2's adapter; the multimodal content-block handling in the container runner also ports.

### Host-side file

```bash
cp "$PROJECT_ROOT/src/image.ts" "$WORKTREE/src/image.ts"
# The test file may need updates for v2 imports — check before copying
cp "$PROJECT_ROOT/src/image.test.ts" "$WORKTREE/src/image.test.ts"
```

Exports preserved:
- `isImageMessage(msg)` — Baileys `WAMessage` check
- `processImage(buffer, groupDir, caption)` → `{ content, relativePath }`
- `parseImageReferences(messages)` — extracts `[Image: attachments/...]` refs

### Add `sharp` as a host dep

The v2 base `package.json` does not include `sharp`. Add via pnpm:

```bash
cd "$WORKTREE" && pnpm add sharp@^0.34.5
```

**Note**: `minimumReleaseAge: 4320` applies. If the pinned version is too new, pick the most recent `sharp` release older than 3 days.

### Integration with v2 WhatsApp adapter

Find v2's WhatsApp adapter's inbound-message handler (`src/channels/whatsapp/` in v2 — exact path depends on what the skill installs). Add a branch that calls `processImage` when `isImageMessage(msg)` is true, saves the processed file to the session's attachment directory, and includes the `[Image: ...]` reference in the routed message text.

v2 sessions have per-session directories. The attachment path in v2 is likely `data/v2-sessions/<session_id>/attachments/` rather than v1's per-group `groups/<folder>/attachments/`. Adjust `processImage`'s `groupDir` param to resolve to the session attachment dir — this may require deferring image processing until after the session is resolved, or processing eagerly and moving the file afterward.

### Container-side multimodal handling

The user's v1 `container/agent-runner/src/index.ts` contains:
- `ImageContentBlock` / `TextContentBlock` types
- Image attachment loading from `/workspace/group/<relativePath>`
- `pushMultimodal(msgs, attachments)` method
- Integration in `runQuery` that base64-encodes images and wraps them in SDK content blocks

**Check v2 first**: `grep -n "ImageContentBlock\|imageAttachments\|toBase64" $WORKTREE/container/agent-runner/src/*.ts`. If v2 already handles multimodal content blocks (likely — multimodal is mature in Claude SDK as of 2026), skip the port; use v2's native support. If missing, port the user's `pushMultimodal` logic into v2's equivalent of the query-building function.

The image path inside the container changes from `/workspace/group/attachments/...` to `/workspace/attachments/...` (or whatever v2 mounts per session). Update `fs.readFileSync` calls accordingly.

## 5.3 Voice transcription (whisper.cpp local)

**Source**: `$PROJECT_ROOT/src/transcription.ts`.

**Port strategy**: copy verbatim as a utility module; integrate with v2 WhatsApp adapter.

### Host-side file

```bash
cp "$PROJECT_ROOT/src/transcription.ts" "$WORKTREE/src/transcription.ts"
```

Exports preserved:
- `isVoiceMessage(msg)` — detects PTT audio messages
- `transcribeAudioMessage(msg, sock)` — downloads, converts to 16kHz WAV, runs whisper

### Dependencies

- `ffmpeg` binary on host (runtime dep, not a pnpm package)
- `whisper-cli` binary on host (from whisper.cpp compile)
- Model file at `data/models/ggml-base.bin` (or whatever `WHISPER_MODEL` env points to)

These are not installed by pnpm; they're system requirements. Document in `.env.example` — add:

```
WHISPER_BIN=whisper-cli
WHISPER_MODEL=/path/to/ggml-base.bin
```

If the user's existing `.env` already has these (Stage 1 preserved it), nothing to add.

### Integration with v2 WhatsApp adapter

Similar to 5.2: find the inbound-message handler, branch on `isVoiceMessage(msg)`, call `transcribeAudioMessage`, use the returned text as the message body (or prepend `[Voice:]` marker). The fallback message `[Voice Message - transcription unavailable]` stays if transcription fails.

The Baileys `sock` param needed by `transcribeAudioMessage` comes from the adapter's connection reference. v2's adapter likely exposes it already.

## 5.4 Emoji reaction status machine (most complex)

**Source**:
- `$PROJECT_ROOT/src/status-tracker.ts` (host-side state machine + persistence)
- `$PROJECT_ROOT/scripts/migrate-reactions.ts` (v1 reactions table in `store/messages.db`)
- `$PROJECT_ROOT/container/agent-runner/src/ipc-mcp-stdio.ts` (v1 `react_to_message` MCP tool)
- `$PROJECT_ROOT/container/skills/reactions/SKILL.md` (v1 container skill docs)

**Port strategy**: the concept ports (emoji reactions on WhatsApp messages, state machine from received→thinking→working→done/failed, crash recovery), but every layer needs rewriting against v2's architecture.

### 5.4.1 Database — reactions table migration

v2 uses numbered migrations at `src/db/migrations/`. Create a new one (next-available number — check the migrations directory first):

```ts
// src/db/migrations/015-reactions.ts  (use next-available number)
import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT NOT NULL,
      message_chat_jid TEXT NOT NULL,
      reactor_jid TEXT NOT NULL,
      reactor_name TEXT,
      emoji TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      PRIMARY KEY (message_id, message_chat_jid, reactor_jid)
    );
    CREATE INDEX IF NOT EXISTS idx_reactions_message   ON reactions(message_id, message_chat_jid);
    CREATE INDEX IF NOT EXISTS idx_reactions_reactor   ON reactions(reactor_jid);
    CREATE INDEX IF NOT EXISTS idx_reactions_emoji     ON reactions(emoji);
    CREATE INDEX IF NOT EXISTS idx_reactions_timestamp ON reactions(timestamp);
  `);
}
```

Register it in `src/db/migrations/index.ts` following the existing pattern.

Add storage helpers (pattern-match v2's existing DB helper style — see `src/db/agent-groups.ts` or `src/db/sessions.ts`):

```ts
// src/db/reactions.ts
export interface Reaction {
  message_id: string;
  message_chat_jid: string;
  reactor_jid: string;
  reactor_name?: string;
  emoji: string;
  timestamp: string;
}

export function storeReaction(r: Reaction): void { /* INSERT OR REPLACE */ }
export function getReactionsForMessage(messageId: string, chatJid: string): Reaction[] { /* SELECT */ }
export function getMessagesByReaction(emoji: string, chatJid?: string): string[] { /* SELECT */ }
```

### 5.4.2 Host-side status tracker

Port `src/status-tracker.ts`, but the **shape of the integration changes** because v2 uses session DBs:

- v1: host invokes container, container phones back via IPC file → status-tracker dispatches reactions directly.
- v2: container writes to `outbound.db` (actions like `schedule`, `approve`, `deliver`); host polls outbound and handles actions.

**Approach**: define a new outbound action `reaction` (or reuse a generic action if v2 has one). Container writes `{ action: 'reaction', message_id, emoji }` rows; `src/delivery.ts` picks them up and calls the adapter's `sendReaction`.

Status-tracker becomes host-side only and reads directly from inbound.db / outbound.db to derive state:
- Message landed in `inbound.db` → send 👀
- Container started processing (first `processing_ack` bump) → send 🧠
- First `outbound.db` write (thinking output) → send 🔄
- Outbound stream closed with success → send ✅
- Outbound stream closed with failure → send ❌

This makes the state machine **derived from DB state** rather than explicitly managed by a tracker class. Simpler and more robust.

Persistence of `data/status-tracker.json` disappears — session DBs are authoritative, so crash recovery is automatic. Any pending-reaction retries that the tracker handled should move into `src/delivery.ts`'s existing retry logic.

### 5.4.3 WhatsApp adapter hook

The WhatsApp adapter installed in Stage 2 needs `sendReaction(chatJid, messageKey, emoji)` if it doesn't already have one. Baileys supports reactions natively:

```typescript
await sock.sendMessage(chatJid, {
  react: { text: emoji, key: messageKey }
});
```

Wire `src/delivery.ts` to call this when it encounters a `reaction` action from `outbound.db`.

### 5.4.4 Container-side MCP tool

v1's `react_to_message` MCP tool lived in `ipc-mcp-stdio.ts` (which is deleted in v2). Replace with a v2 container MCP tool.

Find v2's container MCP tool convention (`container/agent-runner/src/mcp-tools/*.ts`). Add a new tool:

```ts
// container/agent-runner/src/mcp-tools/react-to-message.ts
// Pattern-match existing tools (e.g. self-mod.ts mentioned in CLAUDE.md)
// The tool writes a reaction action to outbound.db, which delivery.ts handles.
```

The exact registration pattern depends on v2's MCP tool loader — grep for `register` / `mcpServer` in `container/agent-runner/src/` to find it.

### 5.4.5 Container-side reactions skill

Replace the v1 `container/skills/reactions/SKILL.md` (which references the dead v1 MCP tool) with a v2-compatible version that references the new tool. Keep the user-facing instructions the same (which emojis to use, when to react, message lookup via DB).

### 5.4.6 Emoji conventions (preserved from v1)

Keep the user's emoji mapping:
- 👀 received
- 🧠 thinking
- 🔄 working
- ✅ done
- ❌ failed

### 5.4.7 Testing

- Send a WhatsApp message to the main agent → expect reactions to land in order
- Force a container crash mid-processing → expect ❌ on restart
- Query `sqlite3 data/v2.db "SELECT * FROM reactions LIMIT 10"` to verify storage

## Verification for Stage 5 overall

After this stage:

- `pnpm run build` succeeds
- `pnpm test` passes (with the new `src/db/migrations/015-reactions.ts` picked up)
- Send a WhatsApp image → agent sees `[Image: ...]` reference, responds with awareness of image
- Send a WhatsApp voice note → transcription appears in logs + agent response
- Send a WhatsApp text → 👀🧠🔄✅ reactions appear in order
- Disconnect WhatsApp for >15min → channel-degraded alert in main group; reconnect → recovery alert

Skip to [Stage 6](stage-6-dev-agent.md).
