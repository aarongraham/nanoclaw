# Stage 1 — Infrastructure Baseline

Goal: get a clean v2 checkout running with the user's `.env`, data directories preserved, and base container image patched for PDF + browser stealth.

Prereqs: worktree at `$WORKTREE` already checked out to `upstream/main`.

## 1.1 Preserve .env

Copy `.env` from main tree to worktree verbatim. Do NOT regenerate it — the user has OneCLI config, API keys, trigger words, dashboard flags, and dev-agent-specific variables dialed in.

Relevant custom vars (all preserved as-is):
- `CREDENTIAL_PROXY_PORT=3001`, `CREDENTIAL_PROXY_HOST` (auto-detected, may not be set)
- `DASHBOARD_ENABLED=true`, `DASHBOARD_PORT=3777`, `DASHBOARD_WRITE` (if set)
- `CHANNEL_ALERT_DEBOUNCE_MS` (default 900000, may not be set)
- `TELEGRAM_BOT_TOKEN`
- `ASSISTANT_HAS_OWN_NUMBER`
- `OPENAI_API_KEY`
- `WHISPER_BIN`, `WHISPER_MODEL` (for voice transcription)
- `GITHUB_TOKEN`, `DEV_AGENT_TELEGRAM_CHAT_ID` (for dev-agent setup)
- OneCLI-related: all `ONECLI_*` vars

v2 does not require `ONECLI_URL` — OneCLI is auto-detected via its SDK.

## 1.2 Preserve data directories

These are user data, not code. Symlink or copy (symlink preferred for live-test):

- `store/` — WhatsApp auth state, reactions DB, QR files. **Warning**: v1's `store/auth/` may not be directly usable by v2's `/add-whatsapp` (path conventions may differ). See Stage 2.
- `groups/` — per-agent-group data (memory files). Preserve the directory; Stage 4 handles the CLAUDE.md content separately since those are code.
- `data/` — **do not copy**. v1's `data/*.db` has an incompatible schema with v2's `data/v2.db` + `data/v2-sessions/`. v2 will create its own DBs on first run.

## 1.3 Patch base Dockerfile

The v2 base Dockerfile (`container/Dockerfile`) exists in the worktree. Apply these three user customizations on top of it. **Read the current v2 Dockerfile first** — some of these may already be present in v2's version.

### a. Add `poppler-utils` to the apt install block

Find the existing `apt-get install` block that installs system packages. Append `poppler-utils` to the package list. This provides `pdftotext` and `pdfinfo` binaries used by the `pdf-reader` container skill (Stage 3).

### b. Set browser stealth env vars

Add these ENV directives somewhere after the system packages are installed. Values from the user's v1 Dockerfile:

```dockerfile
ENV AGENT_BROWSER_USER_AGENT="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
ENV AGENT_BROWSER_ARGS="--disable-blink-features=AutomationControlled --disable-features=IsolateOrigins,site-per-process"
```

These reduce bot-detection fingerprinting when the `agent-browser` MCP tool visits sites.

### c. Install `pdf-reader` CLI

The user has a custom bash wrapper at `container/skills/pdf-reader/pdf-reader` (copied in Stage 3). In the Dockerfile, add a `COPY` instruction that places it at `/usr/local/bin/pdf-reader` and makes it executable:

```dockerfile
COPY skills/pdf-reader/pdf-reader /usr/local/bin/pdf-reader
RUN chmod +x /usr/local/bin/pdf-reader
```

Adjust the path if v2's Dockerfile uses a different COPY prefix.

## 1.4 Rebuild the container image

After the Dockerfile patches:

```bash
cd "$WORKTREE"
./container/build.sh
```

This rebuilds `nanoclaw-agent:latest` with the customizations. CJK fonts remain opt-in via `INSTALL_CJK_FONTS` in `.env` as documented in `CLAUDE.md`.

If the user's system uses Apple Container instead of Docker, `/convert-to-apple-container` handles the runtime switch but the Dockerfile patches above still apply.

## Verification

After this stage:

- `docker run --rm nanoclaw-agent:latest pdftotext -v` should show poppler-utils version
- `docker run --rm nanoclaw-agent:latest pdf-reader --help` should show the wrapper's usage
- `docker run --rm nanoclaw-agent:latest env | grep AGENT_BROWSER` should show both env vars

## What's NOT patched in Stage 1

- The `nanoclaw-dev-agent:latest` image — that's a separate multi-stage build based on `nanoclaw-agent:latest`; handled in Stage 6.
- Any agent-runner code changes — handled in Stage 5 (image vision integration).

Skip to [Stage 2](stage-2-channels-dashboard.md).
