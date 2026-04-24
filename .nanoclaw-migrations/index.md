# NanoClaw v1 → v2 Migration Guide

**Generated**: 2026-04-24T14:40:30+00:00
**Base (last merge with upstream)**: `391b729623d9de6838960561f4b54eaa02746a42`
**HEAD at generation**: `b7ac441dcd2c6ede090e010bd2c10b95d17d8a3f`
**Upstream target**: `41162517d95036bb792f4ff3803bf9be5b02bc44` (upstream/main)

This guide captures a v1→v2 rewrite upgrade for aarongraham's NanoClaw fork. v2 is a ground-up rearchitecture (host + per-session containers, two-DB session split, entity model, pluggable providers) that cannot be merged into v1. Instead, we extract customizations as intent + code snippets and reapply them on a clean v2 base.

## Scope

- 194 local commits on v1 since last upstream merge (`391b729`)
- 448 upstream commits across the v2 rewrite
- 57 user-changed files, +11,306 / -459 lines
- Five separate remotes in play: `origin` (user's fork), `upstream` (qwibitai), `telegram`, `whatsapp` (both qwibitai skill-branch repos, relevant only for v1's pre-skill-branch channel distribution model)

## Applied skills (v1-era, merged from branches)

| Skill | Source | v2 Replacement |
|---|---|---|
| `telegram` channel adapter | `telegram/main` remote (merged `eba6c15`) | `/add-telegram` skill (from `channels` branch) |
| `whatsapp` channel adapter | `whatsapp/main` remote (merged `c0b70b0`) | `/add-whatsapp` skill (native adapter) |
| `reactions` (whatsapp subskill) | `whatsapp/skill/reactions` (`dcd8556`) | No direct v2 skill — port as custom (Stage 5) |
| `voice-transcription` (whatsapp subskill) | `whatsapp/skill/voice-transcription` (`159ad7e`) | No direct v2 skill — port as custom (Stage 5) |
| `local-whisper` (whatsapp subskill) | `whatsapp/skill/local-whisper` (`33766e1`) | Same as above — merges with voice-transcription port |
| `pdf-reader` (whatsapp subskill) | `whatsapp/skill/pdf-reader` (`b48e9cf`) | No host skill needed — container-side bash wrapper only (Stage 3) |
| `image-vision` (whatsapp subskill) | `whatsapp/skill/image-vision` (`6d85745`) | No direct v2 skill — port as custom (Stage 5) |
| `native-credential-proxy` | `upstream/skill/native-credential-proxy` (`d8d9fc9`) | `/use-native-credential-proxy` v2 skill — but user is on OneCLI, so this is superseded |

## Skill interactions / known overlaps

- `image-vision` + `voice-transcription` + `reactions` all hook into the WhatsApp inbound-message path. In v2 they all need to integrate with the skill-installed `/add-whatsapp` adapter, not the user's v1 adapter. They cannot be ported until Stage 2's `/add-whatsapp` is installed.
- `reactions` container skill (v1 MCP tool `react_to_message`) is wired to `ipc-mcp-stdio.ts`, which **does not exist in v2** (IPC-over-stdio is replaced by session DBs). Needs a v2-native MCP tool in the container (see Stage 5).
- `native-credential-proxy` and OneCLI are mutually exclusive. User already runs OneCLI, so this skill's code is dead weight and will not be reapplied.

## Migration stages

Read these in order. Each stage has its own file with the concrete steps, commands, code snippets, and v2 retargeting notes.

1. [Stage 1 — Infrastructure baseline](stage-1-infrastructure.md)
2. [Stage 2 — Channels and dashboard (v2 skills)](stage-2-channels-dashboard.md)
3. [Stage 3 — Container skills (verbatim copies)](stage-3-container-skills.md)
4. [Stage 4 — Agent personas](stage-4-personas.md)
5. [Stage 5 — Optional features (channel health, image vision, voice, reactions)](stage-5-optional-features.md)
6. [Stage 6 — Dev agent + overnight loop](stage-6-dev-agent.md)

[Risk areas and known gotchas](risk-areas.md) — read before starting.

## User's selected customizations to preserve

Confirmed by user during Phase 1 extract:

- ✅ Dashboard: **use `/add-dashboard` skill** (not custom port)
- ✅ Voice transcription (whisper.cpp local)
- ✅ Image vision (sharp + Claude multimodal)
- ✅ Emoji reaction status machine (👀🧠🔄✅❌)
- ✅ Channel health + debounced alerts
- ✅ Dev agent (Argos) + overnight loop: **reimplement via v2 native schedule mechanism**
- ✅ Home Assistant, Seerr, PDF reader, agent-browser customizations (all as container skills)
- ✅ Agent personas (groups/global + groups/main CLAUDE.md)

## What is NOT being migrated

- `src/channels/telegram.ts`, `src/channels/whatsapp.ts`, `src/whatsapp-auth.ts`, `setup/whatsapp-auth.ts` — replaced by v2 skill-installed adapters.
- `src/credential-proxy.ts` + `src/credential-proxy.test.ts` — OneCLI handles this in v2.
- `src/dashboard/*` — replaced by `/add-dashboard` skill.
- `src/group-queue.ts` + cursor-rollback logic in `src/index.ts` — v2 uses sessions + `processing_ack` instead.
- `container/agent-runner/src/ipc-mcp-stdio.ts` — IPC-over-stdio is dead in v2.
- `.github/workflows/bump-version.yml` + `update-tokens.yml` — already deleted, stay deleted.
- `src/ipc.ts` + any IPC-watcher code — replaced by `inbound.db` polling in v2.
- `setup/` directory as a whole — v2 has no top-level setup directory.

## Data directories (preserved, not touched)

- `.env` — copied verbatim (OneCLI config stays valid)
- `store/` — contains WhatsApp auth state from v1; may or may not be reusable depending on `/add-whatsapp`'s path conventions (see Stage 2)
- `data/` — contains v1 SQLite DBs; **do not copy** into v2 (schema is incompatible; v2 will create its own `data/v2.db` and `data/v2-sessions/`)
- `groups/` — CLAUDE.md content is code (covered in Stage 4); memory files (if any) are data and copy across
