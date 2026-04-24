# Adapter Patches

Direct modifications to `src/channels/whatsapp.ts` and `src/channels/telegram.ts`
that diverge from upstream (`upstream/channels`). Re-running `/add-whatsapp` or
`/add-telegram` overwrites these files, so anyone rebuilding an install from the
skills needs to reapply each patch listed here.

Long-term resolution is an upstream hook (`onInboundTransform(msg)` and an
equivalent delivery-time post-processor) so this file can shrink to "open PR
#NNN in qwibitai/nanoclaw adds the hook — no local patches needed." Until then,
keep this file in sync every time you touch either adapter.

Generate the current diff with:

```bash
git fetch upstream channels
git diff upstream/channels -- src/channels/whatsapp.ts src/channels/telegram.ts
```

---

## telegram.ts

1. **Channel-health lifecycle hooks** — `setChannelHealth('telegram', …)`
   wrapped around `bridge.setup()` in `setup()` and a new `teardown()` that
   flips health back to `unknown`. Feeds the same `src/channel-health.ts`
   gauge the dashboard consumes.

All text post-processing for Telegram is already handled upstream by
`telegram-markdown-sanitize.ts` — no divergence there.

## whatsapp.ts

1. **Markdown → WhatsApp formatting** (`formatWhatsApp`, `transformForWhatsApp`,
   `splitProtectedRegions`). Converts `**bold**` → `*bold*`, `*italic*` → `_italic_`,
   headings, links, horizontal rules, while protecting code blocks. Called from
   `deliver()` on both the standalone-text path and file captions.

2. **File-caption formatting** (`deliver()`). Captions run through
   `formatWhatsApp` alongside standalone text so `**bold**` never reaches
   WhatsApp as a literal.

3. **Image resize** in `downloadInboundMedia()` — `sharp(buffer).resize(1024,1024)…jpeg(85)`
   to shrink the payload Claude multimodal sees. Silent fallback to raw buffer
   on error.

4. **Voice transcription** in `downloadInboundMedia()` — `transcribeAudioBuffer`
   (whisper.cpp) on PTT voice notes. The transcript replaces the usually-empty
   text content so Claude sees the words spoken.

5. **Channel-health lifecycle hooks** — `setChannelHealth('whatsapp', …)` on
   `connection.update` (healthy on open, degraded/unknown on close).

6. **Baileys 7 API change** — `chats.phoneNumberShare` was removed in Baileys 7.
   LID-to-phone mapping is populated lazily from `msg.key.senderPn` inside the
   `messages.upsert` handler. If you reinstall `/add-whatsapp` on Baileys 6,
   this reverts and group E2E decryption breaks again — re-bump to `7.0.0-rc.9`
   (or later) and reapply the senderPn block.

7. **Inbound reaction capture** — `messages.reaction` handler that calls
   `storeReaction` (writes into the `reactions` table, migration 014). Skips
   `reaction.key.fromMe` to avoid echoing our own 👀/🧠/🔄 reactions back into
   the DB.

## Resolution plan

- Short term: keep this file current. Every edit to the two adapters gets a
  bullet here in the same commit.
- Medium term: open a PR against `qwibitai/nanoclaw` on the `channels` branch
  that introduces:
  - `onInboundTransform(msg, normalized)` — runs between `normalizeMessageContent`
    and the `setupConfig.onInbound` call. Covers image resize, voice transcription,
    and any future inbound mutation without patching the adapter body.
  - `onOutboundFormat(text, channel)` — runs inside `deliver()` on text +
    captions. Replaces the `formatWhatsApp` / `sanitizeTelegramLegacyMarkdown`
    patches with a host-registerable hook.
  - `onConnectionHealth({ channel, state, reason })` — replaces the direct
    `setChannelHealth` calls (which require the adapter to import a host
    module — the reason both adapters live in the upstream tree with a `//
    FIXME` here).
- Once merged upstream, rip this file out and let the skills reinstall vanilla.
