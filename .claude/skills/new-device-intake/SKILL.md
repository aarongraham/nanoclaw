---
name: new-device-intake
description: Pings Aaron on Telegram when NetAlertX sees a new unlabeled device, parses his reply, and applies the name + Pi-hole group. Runs automatically via a scheduled task created by /install-new-device-intake. Do not invoke manually — it's triggered by NanoClaw's scheduled-task system with device data in your initial context, or by Aaron's reply in the telegram_main thread.
---

# new-device-intake

When a new unlabeled device shows up on the home network, this skill pings Aaron on Telegram with the device details, parses his reply (name + Pi-hole group, or `skip` / `ignore`), and applies the label to both NetAlertX (with `devName` locked) and Pi-hole.

## How it's triggered

**Do not invoke `/new-device-intake` manually.** The workflow is:

- A scheduled task runs every 5 min. Its pre-execution script (`poll.py`) polls NetAlertX, filters, and either emits `{"wakeAgent": false}` or `{"wakeAgent": true, "data": {"device": {...}}}`.
- When `wakeAgent: true`, NanoClaw wakes this agent with `data.device` in context. Follow `handle.md`.
- Aaron's reply in `telegram_main` re-wakes this agent via the mention-sticky session. In that wake there's no `data.device` — instead, the ledger's `pending=1` row tells the agent which MAC the reply is about. Follow `handle.md`.

## Files in this skill

- `poll.py` — pre-execution script (run by NanoClaw's scheduled-task system). Not invoked by the agent.
- `apply.py` — side-effect helper. Agent invokes via Bash with JSON on stdin.
- `handle.md` — the agent's decision tree. Read when woken.
- `lib/` — Python modules (ledger, filter, netalertx, pihole, reply). Don't edit during execution.
- `tests/` — pytest suite. Run after any edit: `cd .claude/skills/new-device-intake && python3 -m pytest tests/`.

## Manual debugging

Dry-run the poller without touching the real ledger:

```bash
NETALERTX_API_TOKEN="..." python3 .claude/skills/new-device-intake/poll.py \
  --dry-run \
  --ledger /tmp/intake.db \
  --log /tmp/intake.log
```

Inspect current ledger state:

```bash
sqlite3 ~/projects/nanoclaw/data/new-device-intake.db 'SELECT * FROM intake;'
```

Watch the poll log:

```bash
tail -f ~/projects/nanoclaw/logs/new-device-intake.log
```
