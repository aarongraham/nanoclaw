# Stage 3 — Container Skills (Verbatim Copies)

Goal: bring the user's custom container skills into v2. All of these are self-contained instruction files or small binaries with no v1 architecture dependencies.

Container skills live at `container/skills/<name>/` and are mounted into every agent session at `/workspace/skills/<name>/`.

## 3.1 home-assistant

**Source**: `container/skills/home-assistant/SKILL.md` in the main tree.

**Copy verbatim** to the worktree. No modifications needed — it's pure bash/curl instructions with hardcoded credentials for the user's Home Assistant instance.

Key content (preserve):
- URL: `http://192.168.42.11:8123`
- Bearer token: the long-lived JWT baked into the file (user-specific, do NOT regenerate)
- Entity discovery patterns (climate.*, person.*)
- HVAC control commands for Fujitsu Airstage units
- Presence detection via person.aaron and zone.home

```bash
mkdir -p "$WORKTREE/container/skills/home-assistant"
cp "$PROJECT_ROOT/container/skills/home-assistant/SKILL.md" "$WORKTREE/container/skills/home-assistant/"
```

## 3.2 seerr-media

**Source**: `container/skills/seerr-media/SKILL.md` in the main tree.

**Copy verbatim**. This skill defines strict IRON LAWS for TMDB ID handling — do not rewrite, do not "improve". The constraints are load-bearing against hallucinated IDs.

Key content (preserve):
- URL: `http://192.168.42.11:5055`
- API key (user-specific)
- The four IRON LAWS (search first, never fabricate, user confirmation, verify after)
- The self-check prompts

```bash
mkdir -p "$WORKTREE/container/skills/seerr-media"
cp "$PROJECT_ROOT/container/skills/seerr-media/SKILL.md" "$WORKTREE/container/skills/seerr-media/"
```

## 3.3 pdf-reader

**Source**: `container/skills/pdf-reader/` in the main tree (contains `SKILL.md` and a bash binary named `pdf-reader`).

**Copy verbatim**. Depends on `poppler-utils` being in the base image (handled in Stage 1).

```bash
mkdir -p "$WORKTREE/container/skills/pdf-reader"
cp "$PROJECT_ROOT/container/skills/pdf-reader/SKILL.md"  "$WORKTREE/container/skills/pdf-reader/"
cp "$PROJECT_ROOT/container/skills/pdf-reader/pdf-reader" "$WORKTREE/container/skills/pdf-reader/"
chmod +x "$WORKTREE/container/skills/pdf-reader/pdf-reader"
```

The Dockerfile in Stage 1 already includes a `COPY` line that places this at `/usr/local/bin/pdf-reader` during image build.

## 3.4 agent-browser customization

**Source**: `container/skills/agent-browser/SKILL.md` in the main tree.

v2 has its own `agent-browser` skill (installed from the `container/skills/` base directory). The user added a "Simple fetches" section on top of v2's version.

**Do NOT overwrite the entire file** — v2 may have updated the rest. Instead:

1. Read v2's version at `$WORKTREE/container/skills/agent-browser/SKILL.md`
2. Read the user's version at `$PROJECT_ROOT/container/skills/agent-browser/SKILL.md`
3. Find the "Simple fetches" section in the user's file (it's a short subsection explaining that `curl` should be tried before falling back to the browser for speed and to avoid being blocked)
4. Append it to v2's version if not already present

```bash
diff "$PROJECT_ROOT/container/skills/agent-browser/SKILL.md" "$WORKTREE/container/skills/agent-browser/SKILL.md"
# Apply just the user's "Simple fetches" addition; leave the rest of v2's content
```

## 3.5 reactions container skill

**Important**: the user's `container/skills/reactions/SKILL.md` references the v1 MCP tool `mcp__nanoclaw__react_to_message` which does not exist in v2 (it was defined in `container/agent-runner/src/ipc-mcp-stdio.ts`, which is gone).

**Do not copy this SKILL.md verbatim.** It will be replaced in Stage 5 as part of the emoji-reactions feature port, along with a new v2-native MCP tool.

If the user wants reactions available before Stage 5 is done: skip this skill entirely. The container will work without it.

## Verification

After this stage:

- `ls $WORKTREE/container/skills/` should include: `home-assistant`, `seerr-media`, `pdf-reader`, `agent-browser` (updated), plus whatever v2 ships (welcome, self-customize, slack-formatting).
- Rebuild the container: `cd "$WORKTREE" && ./container/build.sh`
- Run a quick smoke test: `docker run --rm nanoclaw-agent:latest cat /workspace/skills/home-assistant/SKILL.md | head -5` — should show the skill metadata.

Skip to [Stage 4](stage-4-personas.md).
