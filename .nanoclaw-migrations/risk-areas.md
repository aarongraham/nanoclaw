# Risk Areas & Known Gotchas

Read before starting Phase 2 upgrade. These are the places where things are most likely to go wrong.

## 1. IPC layer is entirely dead in v2

v1's host↔container communication was file-based IPC under `/workspace/ipc/`. v2 replaced this with two SQLite DBs per session (`inbound.db`, `outbound.db`). **Anything that references `/workspace/ipc/*` in v1 is broken in v2.**

Affected (to remove or rewrite):
- `src/ipc.ts` (the host-side IPC watcher) — gone from v2; do not port
- `src/ipc-auth.test.ts` — same
- `container/agent-runner/src/ipc-mcp-stdio.ts` — gone from v2
- User's `groups/main/CLAUDE.md` instructions reference `/workspace/ipc/available_groups.json` and `/workspace/ipc/tasks/` — rewrite these to query central DB instead (Stage 4)
- The `reactions` container skill references `mcp__nanoclaw__react_to_message` which was defined in `ipc-mcp-stdio.ts` — replaced with a new v2 MCP tool in Stage 5

**Red flag**: if any post-migration file contains the string `/workspace/ipc/`, it's still on v1.

## 2. Emoji reactions port is the hardest part

The v1 implementation relied on:
- An in-memory state machine (`StatusTracker`) that the host mutates directly
- Persistence to `data/status-tracker.json` for crash recovery
- Direct invocation from the IPC watcher
- A single `messages.db` with the `reactions` table

v2 architecture means:
- No single `messages.db` — split into central DB + per-session DBs
- No IPC watcher — host polls `outbound.db`
- State must be derived from DB state (or the container must emit explicit actions)

Stage 5.4 describes the port. The risk areas within it:
- Mismatched emoji timing if the state-derivation-from-DB approach fires events at slightly different points than v1's explicit mutations
- Reaction race conditions if the container emits multiple state transitions faster than `host-sweep.ts` polls
- The v2 MCP tool needs to be registered in the container, which depends on v2's tool-loader pattern (TBD until you grep for it)

**If emoji reactions don't work right after migration**: it's ok to ship them broken or disabled initially. The rest of the agent works without them. Revisit after everything else is stable.

## 3. WhatsApp auth state may not migrate

v1 stores Baileys multi-file auth state at `store/auth/`. v2's `/add-whatsapp` may use a different path (e.g., per-agent-group location). Two failure modes:

- **Symptom**: after migration, WhatsApp shows "not connected" and no QR code — the adapter found something at its expected path and thinks it's authenticated, but it's stale/wrong.
- **Symptom**: WhatsApp works briefly then hard-disconnects with `DisconnectReason.loggedOut` — auth state loaded but server invalidated it.

**Recommended**: just re-authenticate. Delete whatever auth state v2 thinks it has, let it emit a fresh QR, scan from the phone. Takes 15 seconds.

## 4. pnpm release-age gate may block deps

v2's `pnpm-workspace.yaml` has `minimumReleaseAge: 4320` (3 days). Packages released in the last 3 days won't resolve.

Affected:
- `sharp` (for image-vision port): most versions are months-old, unlikely to hit the gate
- Any pinned version in a v2 skill that was updated in the last 3 days

**If pnpm install fails** with "release age policy violated": pick the most recent version >3 days old. **Do not add to `minimumReleaseAgeExclude` without explicit human approval** per CLAUDE.md rules.

## 5. Container rebuild cache

Per CLAUDE.md: "the container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps."

After any Dockerfile or `container/skills/` change, if the behavior doesn't update: prune the builder and re-run `./container/build.sh`. Don't wonder why the new skill isn't mounted; just prune.

## 6. Dev-agent image takes 10-20min to build first time

Erlang compiles from source via asdf+kerl. The first `./container/build-dev-agent.sh` is slow. Subsequent builds are cached unless `.tool-versions` in `/opt/argos` changes.

**If the build fails partway through**: subsequent runs pick up from the cached layer. Don't `docker builder prune` between retries unless you suspect a stale layer is the problem.

## 7. OneCLI secret mode "selective" gotcha

Per CLAUDE.md: auto-created agents start in `selective` secret mode — no secrets assigned by default. If the dev agent gets 401s from GitHub/Postgres/etc. despite credentials being in the vault, run:

```bash
onecli agents set-secret-mode --id <dev-agent-id> --mode all
```

## 8. Agent-runner changes may duplicate v2 work

The user's v1 agent-runner has multimodal image loading code. v2 likely has its own multimodal support (by 2026, Claude SDK multimodal is stable).

**Check first**: `grep -l "base64\|image\|multimodal\|ImageContent" $WORKTREE/container/agent-runner/src/*.ts`.

If v2 handles it natively: **do not port** the user's additions. Just ensure image file paths match whatever v2 expects.

If v2 doesn't: port carefully, matching the pattern used by whatever content block types v2 exports.

## 9. Hardcoded IPs and tokens in custom container skills

`home-assistant/SKILL.md` and `seerr-media/SKILL.md` have baked credentials pointing at `192.168.42.11`. These are user-specific and correct — **do not sanitize or parameterize**. Copy verbatim.

If the user ever moves their home server or rotates tokens, they'll edit these skill files directly. Not a migration concern.

## 10. Baileys pre-release version `^7.0.0-rc.9`

The user's v1 `package.json` pins `@whiskeysockets/baileys@^7.0.0-rc.9`. This is pre-release.

In v2, you're **not** adding Baileys directly — it comes from `/add-whatsapp`. That skill pins its own version. **Do not carry forward `^7.0.0-rc.9`.**

If `/add-whatsapp` installs an older stable version (e.g., `6.7.x`), some of the adapter behaviors may differ from what the user is used to. Most user-visible behavior (messaging, reactions, group sync) is stable across versions; pairing-code UX may be the main difference.

## 11. Data preservation: don't copy v1 DB

v1 DBs at `data/*.db` and `store/messages.db` have schemas incompatible with v2. **Do not copy them into the worktree.**

What you CAN copy:
- `.env` (Stage 1)
- `groups/` directory (Stage 1 for the directory, Stage 4 for CLAUDE.md content)
- `store/auth/` (maybe; see risk #3)
- WhatsApp image attachments from `groups/<folder>/attachments/` — not load-bearing; can skip

What you must NOT copy:
- `data/*.db`
- `store/messages.db`
- `data/status-tracker.json`

v2 will initialize fresh DBs on first start. You lose v1 message history — that's expected.

## 12. The 448 upstream commits include unrelated fixes

The v2 rewrite isn't a single refactor — it's 448 commits spanning architectural changes, bug fixes for features that no longer exist in your fork, and skill additions (Signal, iMessage, Matrix, etc.) that are orthogonal to your setup.

You don't need to understand all 448 commits. The stages above target specifically what the user has; everything else in v2 either stays as installed-from-upstream defaults or can be ignored.
