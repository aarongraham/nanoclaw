# Stage 2 — Channels and Dashboard (v2 Skills)

Goal: install the v2 skills that replace the user's v1 channel adapters and dashboard. These are skill-installed modules; the host registers them at startup via the `src/channels/` barrel.

Run each skill from inside the worktree.

## 2.1 Telegram — `/add-telegram`

From the worktree:
```bash
cd "$WORKTREE"
# Trigger the skill (via Claude Code)
/add-telegram
```

The skill performs:
- `git fetch origin channels` (the v2 channels branch)
- Copies `src/channels/telegram.ts` + helpers into the worktree
- Appends `import './telegram';` to `src/channels/index.ts`
- `pnpm install <pinned-telegram-pkg-version>`
- Rebuild

**Credential migration**: `TELEGRAM_BOT_TOKEN` from `.env` is used as-is. No state migration needed — Telegram bots are stateless.

**What the user's v1 had that the v2 skill does not need**: the custom `src/channels/telegram.ts` at the user's base (using `grammy@^1.39.3`). Drop it — v2's implementation is maintained upstream.

## 2.2 WhatsApp — `/add-whatsapp`

From the worktree:
```bash
cd "$WORKTREE"
/add-whatsapp
```

The v2 `/add-whatsapp` skill installs a **native Baileys-based adapter** that lives under `src/channels/whatsapp/` (not a single file like v1). It handles QR auth, pairing code, message ingestion, group sync, and reactions.

**Auth state migration (the hard part)**:

- v1 auth state lives in `store/auth/` (Baileys multi-file auth).
- v2's `/add-whatsapp` may expect a different location — likely `store/whatsapp-auth/` or a per-agent-group path.
- **Recommended approach**: re-authenticate from scratch. v1 auth state is ~30 small files; re-auth via QR code takes ~15 seconds.
- If re-auth is painful: after running `/add-whatsapp`, inspect where it expects auth state (`grep -r 'useMultiFileAuthState\|AUTH_DIR' src/channels/whatsapp/`) and symlink/copy from `store/auth/` to that path before first start.

**What the user's v1 had that the v2 skill does not need**:
- `src/channels/whatsapp.ts`, `src/channels/whatsapp.test.ts`
- `src/whatsapp-auth.ts` (standalone auth CLI)
- `setup/whatsapp-auth.ts` (QR HTML page setup flow)
- `setup/groups.ts` (group sync with retry logic) — v2's skill has its own group sync; drop this.
- `package.json` direct deps: `@whiskeysockets/baileys`, `qrcode`, `qrcode-terminal`, `sharp` — all installed by the skill at pinned versions. **Do not manually add them.**

**Image/voice integration**: `/add-whatsapp` alone does NOT install image-vision or voice-transcription. Those are Stage 5 custom ports.

## 2.3 Dashboard — `/add-dashboard`

From the worktree:
```bash
cd "$WORKTREE"
/add-dashboard
```

The v2 `/add-dashboard` skill installs a monitoring dashboard on `DASHBOARD_PORT` (default 3777). It reads from v2's central DB + session DBs, so it works with the v2 schema natively.

**Post-install checks**:
- `.env` should already have `DASHBOARD_ENABLED=true` and `DASHBOARD_PORT=3777` — verify they're still present after skill install.
- Visit `http://localhost:3777` after start to confirm.

**What the user's v1 dashboard had that the v2 skill may lack**:
- WebSocket log streaming (`src/dashboard/log-stream.ts`) — v1 intercepted `process.stdout.write` + `process.stderr.write` and streamed log lines over `ws://.../ws/logs`
- Per-container docker stats (`docker stats --no-stream --format {{json .}}`)
- Channel health indicators (driven by `src/channel-health.ts`)

**If any of those are missing from `/add-dashboard`**: flag during live-test. Can be added as custom extensions post-migration (Stage 5's channel-health port will surface in the dashboard via direct import regardless).

## Verification

After this stage:

- `pnpm run build` in the worktree should succeed with all three channels registered.
- `src/channels/index.ts` should have `import './telegram';` and `import './whatsapp';` (or whatever v2's registration pattern uses).
- `pnpm test -- --run channels` (or equivalent) should pass.
- `.env` should still contain all the user's custom values from Stage 1.

Skip to [Stage 3](stage-3-container-skills.md).
