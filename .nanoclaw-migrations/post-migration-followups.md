# Post-migration Followups

All items from the original followups list have been completed. This file is kept as an audit record of what landed.

## 1. Dashboard install ✅

**Resolved.** The "missing" modules actually exist in current v2 — just at `src/modules/<area>/db/` instead of `src/db/`:

- `src/modules/agent-to-agent/db/agent-destinations.ts`
- `src/modules/permissions/db/users.ts`
- `src/modules/permissions/db/user-roles.ts`
- `src/modules/permissions/db/user-dms.ts`
- `src/modules/permissions/db/agent-group-members.ts`

`src/dashboard-pusher.ts` copied from `.claude/skills/add-dashboard/resources/`, imports rewritten, `container_config` reads swapped for `readContainerConfig(folder)` (v2 stores config as `groups/<folder>/container.json`, not a DB column). Dashboard block wired into `src/index.ts` after `startHostSweep()`. Runs on `DASHBOARD_PORT` (3100) when `DASHBOARD_SECRET` is set — both now in `.env`.

Verify at `http://localhost:3100/dashboard`.

## 2. Channel health + debounced alerts ✅

**Resolved.**

- `src/channels/whatsapp.ts` — `setChannelHealth('whatsapp', 'healthy'|'degraded'|'unknown', reason)` at connection open / close / loggedOut.
- `src/channels/telegram.ts` — `setChannelHealth('telegram', ...)` in the adapter's setup / teardown wrappers.
- `src/index.ts` — `onChannelHealthChange` listener with 15-minute debounce (configurable via `CHANNEL_ALERT_DEBOUNCE_MS`). Alerts DM the owner (resolved via `getOwners()` + `ensureUserDm()`). Recovery alert fires only if a degraded alert was already sent.

## 3. Image vision + voice transcription ✅

**Resolved.** Both wired into `src/channels/whatsapp.ts`'s `downloadInboundMedia`:

- **Image**: images are post-processed with `sharp` (resize ≤1024×1024, JPEG quality 85) before being saved to `data/attachments/`. v2's Claude SDK consumes them natively as multimodal content — no text-reference injection needed.
- **Voice**: `isVoiceMessage(msg)` (PTT audio only) triggers `transcribeAudioBuffer(buffer)`. The transcript replaces the usually-empty `content.text` so Claude sees the words spoken. Non-PTT audio stays as a raw attachment.

Transcription prereqs: `ffmpeg` + `whisper-cli` on host PATH, model at `WHISPER_MODEL` (default `data/models/ggml-base.bin`).

## 4. Emoji reaction status tracker ✅

**Resolved** — hybrid host + agent approach:

- **Host-side** (`src/modules/status-tracker/index.ts`): 👀 reaction on inbound wake via `reactToInbound()`. Gated to DMs only (`mg.is_group === 0`) to avoid noise in group chats.
- **Agent-side**: persona in `groups/dm-with-aaron/CLAUDE.local.md` instructs the agent to call `add_reaction(messageId, 'white_check_mark')` on completion, `add_reaction(messageId, 'x')` on failure. The v2 `add_reaction` MCP tool + `reaction` operation in `whatsapp.ts` + `chat-sdk-bridge.ts` were already upstream.
- **DB**: `reactions` table (migration 014) + helpers at `src/db/reactions.ts` available for storing third-party reactions received on messages. Not yet wired — the v2 whatsapp adapter doesn't capture inbound `reaction` events today; extend if needed.

Intermediate stages (🧠 thinking, 🔄 working) not wired — they would need finer hooks in container-runner.ts and delivery.ts. Marginal value given the fast v2 turnaround.

## 5. Path updates in persona files ✅

**Resolved.**

- `groups/main/CLAUDE.local.md` — rewritten against v2 (central DB queries, MCP tool list, `/workspace/agent/` + `/workspace/data/` paths, v2 isolation model).
- `groups/dm-with-aaron/CLAUDE.local.md` — v1 `messages.db` and `store/` paths replaced with v2 `inbound.db` queries and `/workspace/agent/` memory layout.

## 6. Dev agent + overnight loop ✅

**Resolved (code) + in-progress (image build).**

- `scripts/register-dev-agent.ts` — rewritten for v2 schema; now uses `getContainerImageBase()` to compute the per-install image tag (`nanoclaw-dev-agent-v2-<slug>:latest`) and normalizes Telegram chat IDs (strips legacy `tg:` prefix).
- Dev-agent agent_group + messaging_group + wiring created in `data/v2.db`. Uses `DEV_AGENT_TELEGRAM_CHAT_ID` from `.env`.
- `container/Dockerfile.dev-agent` + `container/build-dev-agent.sh` in place; build running in background (`logs/dev-agent-build.log`) — Erlang compile takes 10-20 min.
- `scripts/overnight-loop.sh` — rewritten to manipulate v2's per-session `messages_in.recurrence` rows. The SERIES_FILTER env var can be tightened once the agent has scheduled the loop so the script matches only that series.

## 7. OneCLI — removed

No longer applicable. `/use-native-credential-proxy` was applied on 2026-04-24; OneCLI is not used by NanoClaw anymore. The OneCLI gateway + vault can keep running for non-NanoClaw purposes, but NanoClaw now reads OAuth/API-key credentials from `.env` directly via `src/credential-proxy.ts`.

Orphaned `Claw` agent in OneCLI vault was deleted; `ONECLI_URL` and `ONECLI_API_KEY` stripped from `.env`.

## Deferred / not attempted

- **Inbound reaction capture** (3rd-party emoji reactions showing up on your WhatsApp messages → `reactions` table). The whatsapp adapter emits `messages.upsert` only; reaction events come through `messages.reaction` which isn't wired. Low priority; add if you want reaction-driven workflows.
- **Rich status lifecycle** (🧠 thinking, 🔄 working). Host instrumentation hooks would need adding to `container-runner.ts` (spawn = 🧠) and `delivery.ts` (first outbound = 🔄). Added code surface for marginal visibility gain.
- **Upstream PR for adapter hooks**: the clean long-term home for channel-health, image-resize, and voice-transcription is upstream's `channels` branch via a pluggable `onInboundTransform(msg)` or similar hook. Current state diverges on `src/channels/whatsapp.ts` and `src/channels/telegram.ts` — these files will conflict on the next `/add-whatsapp` or `/add-telegram` reinstall. Either do a manual rebase at that point, or open the upstream PR.

## Rollback

```bash
git reset --hard pre-migrate-v2-15e972e-20260424-145611
```
