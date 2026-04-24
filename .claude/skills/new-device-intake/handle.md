# Handling an intake wake

Two wake types. Figure out which you are by whether `data.device` is in your initial context.

## Wake type 1: Initial wake (data.device is present)

You receive `data.device = {mac, ip, vendor, name_hint, firstSeen, lastSeen, netalertx_url}`.

**Step A — Compose and send the initial Telegram message.** Use `mcp__nanoclaw__send_message` with the `telegram_main` JID (it's stamped into the scheduled-task prompt at install time — look for a string like `tg:...` in your initial context). Message body, substituting the data fields:

```
🆕 New device on the network

MAC:    <mac> (<vendor>)
IP:     <ip>
Name:   <name_hint>  (from DHCP, not labeled)
First:  <firstSeen>
Link:   <netalertx_url>

Reply with: <name>, <group>   (e.g. "Fleur's iPhone, ad blocking")
Or: "skip" (ask again in 3 days) / "ignore" (never ask)
```

**Step B — Exit.** The ledger was already written by `poll.py` (row with `pending=1` for this MAC). The mention-sticky session keeps this agent hot for the reply.

## Wake type 2: Reply wake (inbound message in telegram_main, no data.device)

**Step A — Look up the pending MAC from the ledger:**

```bash
sqlite3 /home/aaron/projects/nanoclaw/data/new-device-intake.db \
  "SELECT mac FROM intake WHERE pending=1;"
```

If no row is returned: the reply came after the 3-day timeout already cleared the pending row. Reply `no pending device — that one already timed out. I'll re-ask if it comes back online.` and exit.

**Step B — Classify the reply.** Use the `lib/reply` module via a short inline Python invocation:

```bash
cd /home/aaron/projects/nanoclaw/.claude/skills/new-device-intake
python3 - <<'EOF'
import json, sys
from lib import reply
text = """<Aaron's reply text — paste verbatim>"""
intent = reply.classify_intent(text)
parsed = reply.parse_label(text) if intent == "label" else None
print(json.dumps({"intent": intent, "parsed": parsed}))
EOF
```

**Step C — Branch on `intent`:**

### `intent == "skip"`

```bash
sqlite3 /home/aaron/projects/nanoclaw/data/new-device-intake.db \
  "UPDATE intake SET pending=0 WHERE mac='<MAC from Step A>';"
```

Reply to Aaron: `👍 skipped, I'll ask again in 3 days if it's still around`. Exit.

### `intent == "ignore"`

```bash
sqlite3 /home/aaron/projects/nanoclaw/data/new-device-intake.db \
  "UPDATE intake SET pending=0, dismissed=1 WHERE mac='<MAC>';"
```

Reply: `🙈 ok, muted forever for that MAC`. Exit.

### `intent == "label"`

Check `parsed`:

- If `parsed.name == ""`: reply `got the group but no name — what should I call it?` and exit. Leaves `pending=1` so his next message continues the conversation.
- If `parsed.group is None`: reply `got the name <parsed.name> — which group? (ad blocking / iot / unrestricted / default)` and exit.

Both present → build the apply request and invoke `apply.py`:

```bash
cat <<JSON | python3 /home/aaron/projects/nanoclaw/.claude/skills/new-device-intake/apply.py
{
  "mac": "<MAC from Step A>",
  "name": "<parsed.name>",
  "owner": "<parsed.owner>",
  "type": "<inferred from name/vendor if obvious: Phone / TV / IoT / Laptop / Tablet / Smart Speaker / etc., else empty>",
  "location": "<Aaron's original reply text, trimmed — this is the human-readable blurb that shows up in NetAlertX's Location column>",
  "group_id": <parsed.group>,
  "pihole_comment": "<parsed.name> [<location>]"
}
JSON
```

Read the stdout JSON:

- `{"netalertx": "ok", "pihole": "ok"}` → success. Mark the ledger dismissed so it never re-asks:
  ```bash
  sqlite3 /home/aaron/projects/nanoclaw/data/new-device-intake.db \
    "UPDATE intake SET pending=0, dismissed=1 WHERE mac='<MAC>';"
  ```
  Reply: `✅ named <name>, group=<group_name>, owner=<owner>, type=<type>` (where `<group_name>` is the human name from the alias table — Default / Ad Blocking / IoT Blocked / Unrestricted).

- Any `"failed: ..."` → report the partial state to Aaron with the error string. **Leave `pending=1`** (don't touch the ledger). His next reply can retry.

### `intent == "ambiguous"`

Reply: `didn't catch that — name + group, or "skip" / "ignore"?`. Exit. Ledger stays `pending=1`.

## Group name → ID cheat sheet

When Aaron's reply gets parsed to a `group_id`, translate to this human name for the confirmation message:

| ID | Name |
|----|------|
| 0 | Default |
| 1 | Ad Blocking |
| 2 | IoT Blocked |
| 3 | Unrestricted |

## Error paths

- `apply.py` exits non-zero: the JSON you built was malformed. Tell Aaron "I hit an internal error building the apply request — try replying again" and exit with `pending=1` untouched.
- `sqlite3` returns an error: say "ledger read failed: <err>" and exit.
- `mcp__nanoclaw__send_message` errors: propagate naturally — NanoClaw's delivery layer will log.
