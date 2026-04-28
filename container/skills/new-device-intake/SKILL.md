---
name: new-device-intake
description: Handles new-device intake events from the home network. Use when (a) you wake on a scheduled task with `device` data in context (NetAlertX detected a new unlabeled device — send Aaron a Telegram ping), or (b) Aaron sends a message in his DM and there's a pending intake row in the ledger (parse his reply and apply the label to NetAlertX + Pi-hole). On every Telegram DM wake, check the ledger first — see "When to invoke" below.
---

# new-device-intake

When NetAlertX sees a new unlabeled device on the home network, this skill pings Aaron on Telegram with the device details, parses his reply (name + Pi-hole group, or `skip` / `ignore`), and applies the label to both NetAlertX (with `devName` locked) and Pi-hole.

## When to invoke

Two trigger paths:

1. **Initial wake** — the scheduled task fires you with `device = {mac, ip, vendor, name_hint, firstSeen, netalertx_url}` in your prompt context. Follow "Initial wake" below.

2. **Reply wake** — every time you wake to handle an inbound Telegram message in Aaron's DM, **first** check the intake ledger:

   ```bash
   sqlite3 /workspace/agent/data/new-device-intake.db \
     "SELECT mac FROM intake WHERE pending=1;"
   ```

   If there's a result, the inbound message is likely a reply to your last intake ping. Follow "Reply wake" below. If there's no pending row, fall through to your normal DM handling.

## Initial wake

You have `device.mac`, `device.ip`, `device.vendor`, `device.name_hint`, `device.firstSeen`, `device.netalertx_url` in context.

The ledger row was already written by `poll.py` (`pending=1` for this MAC). Your job: send a single Telegram message and exit.

Use `mcp__nanoclaw__send_message` (no `to` needed — this agent has one destination). Body:

```
🆕 New device on the network

MAC:    <device.mac> (<device.vendor>)
IP:     <device.ip>
Name:   <device.name_hint>  (from DHCP, not labeled)
First:  <device.firstSeen>
Link:   <device.netalertx_url>

Reply with: <name>, <group>   (e.g. "Fleur's iPhone, ad blocking")
Or: "skip" (ask again in 3 days) / "ignore" (never ask)
```

Exit. The session stays open; Aaron's reply will re-wake you.

## Reply wake

You have a `pending` MAC from the ledger lookup above and Aaron's reply text as the inbound message.

### Step 1: Classify the reply

```bash
cd /home/node/.claude/skills/new-device-intake
python3 - <<'EOF'
import json, sys
from lib import reply
text = """<paste Aaron's reply text verbatim>"""
intent = reply.classify_intent(text)
parsed = reply.parse_label(text) if intent == "label" else None
print(json.dumps({"intent": intent, "parsed": parsed}))
EOF
```

### Step 2: Branch on `intent`

#### `skip`

```bash
sqlite3 /workspace/agent/data/new-device-intake.db \
  "UPDATE intake SET pending=0 WHERE mac='<MAC>';"
```

Reply: `👍 skipped, I'll ask again in 3 days if it's still around`. Exit.

#### `ignore`

```bash
sqlite3 /workspace/agent/data/new-device-intake.db \
  "UPDATE intake SET pending=0, dismissed=1 WHERE mac='<MAC>';"
```

Reply: `🙈 ok, muted forever for that MAC`. Exit.

#### `label`

Validate:
- If `parsed.name == ""` → reply `got the group but no name — what should I call it?` and exit (leaves `pending=1`, you'll re-classify next reply).
- If `parsed.group is None` → reply `got the name <parsed.name> — which group? (ad blocking / iot / unrestricted / default)` and exit.

Both present → run apply.py with stdin JSON:

```bash
cat <<JSON | python3 /home/node/.claude/skills/new-device-intake/apply.py
{
  "mac": "<MAC from ledger>",
  "name": "<parsed.name>",
  "owner": "<parsed.owner>",
  "type": "<inferred from name/vendor if obvious: Phone / TV / IoT / Laptop / Tablet / Smart Speaker / etc., else empty>",
  "location": "<Aaron's original reply text, trimmed — shows up in NetAlertX's Location column>",
  "group_id": <parsed.group>,
  "pihole_comment": "<parsed.name> [<location>]"
}
JSON
```

Read the stdout JSON:

- `{"netalertx": "ok", "pihole": "ok"}` → success. Mark dismissed (so we never re-ask):
  ```bash
  sqlite3 /workspace/agent/data/new-device-intake.db \
    "UPDATE intake SET pending=0, dismissed=1 WHERE mac='<MAC>';"
  ```
  Reply: `✅ named <name>, group=<group_name>, owner=<owner>, type=<type>` (translate `group_id` → name via the table below).

- Any `"failed: ..."` → report the partial state to Aaron with the error. **Leave `pending=1`** — Aaron's next reply can retry.

#### `ambiguous`

Reply: `didn't catch that — name + group, or "skip" / "ignore"?`. Exit. Ledger stays `pending=1`.

## Group ID → name

| ID | Name |
|----|------|
| 0 | Default |
| 1 | Ad Blocking |
| 2 | IoT Blocked |
| 3 | Unrestricted |

## Operational notes

- **Don't invoke this skill manually** with `/new-device-intake`. The flow is driven by the scheduled task installed by `/install-new-device-intake` and by Aaron's Telegram replies.
- **Debug recipes:**
  - Tail the poll log: `tail -f /workspace/agent/logs/new-device-intake.log`
  - Inspect ledger: `sqlite3 /workspace/agent/data/new-device-intake.db 'SELECT * FROM intake;'`
  - Dry-run the poller: `python3 /home/node/.claude/skills/new-device-intake/poll.py --dry-run --ledger /tmp/intake-dry.db --log /tmp/intake-dry.log`
- **NETALERTX_API_TOKEN** must be in the container's environment (passed in via `groups/dm-with-aaron/container.json`'s env passthrough or the host `.env`).
