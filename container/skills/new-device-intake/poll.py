#!/usr/bin/env python3
"""Pre-execution script for the new-device-intake scheduled task.

Runs every 5 min INSIDE the agent container (via the schedule_task `script`
field — bash content that invokes this file). Emits a single JSON object
to stdout per the V2 contract:

  {"wakeAgent": true, "data": {"device": {...}}}  -> agent wakes with context
  {"wakeAgent": false}                             -> task quietly completes

Default paths assume V2 container mounts:
- ledger at /workspace/agent/data/...    (groups/<folder>/data/, RW)
- log    at /workspace/agent/logs/...    (groups/<folder>/logs/, RW)
- skill  at /home/node/.claude/skills/new-device-intake/  (RO symlink)
"""
import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

# Skill root contains lib/; make it importable whether invoked by absolute
# path or the schedule_task bash one-liner.
sys.path.insert(0, str(Path(__file__).parent))

from lib import filter as flt  # noqa: E402
from lib import ledger as led  # noqa: E402
from lib import netalertx  # noqa: E402

DEFAULT_LEDGER = "/workspace/agent/data/new-device-intake.db"
DEFAULT_LOG = "/workspace/agent/logs/new-device-intake.log"
DEFAULT_NETALERTX = "http://192.168.42.11:20212"


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj))
    sys.stdout.flush()


def _setup_logging(path: str) -> logging.Logger:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("new-device-intake")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    h = logging.FileHandler(path)
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(h)
    return logger


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--ledger", default=DEFAULT_LEDGER)
    p.add_argument("--log", default=DEFAULT_LOG)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)

    logger = _setup_logging(args.log)
    now = int(time.time())

    base = os.environ.get("NETALERTX_BASE", DEFAULT_NETALERTX)
    token = os.environ.get("NETALERTX_API_TOKEN", "")
    if not token:
        logger.error("NETALERTX_API_TOKEN is empty; cannot poll")
        _emit({"wakeAgent": False})
        return 0

    try:
        devices = netalertx.get_devices(base, token)
    except netalertx.NetAlertXError as e:
        logger.warning("NetAlertX unreachable: %s -- skipping cycle", e)
        _emit({"wakeAgent": False})
        return 0

    conn = led.open_db(args.ledger)
    try:
        pending = led.get_pending(conn)
        if pending is not None:
            elapsed = now - pending["last_asked_at"]
            if elapsed < flt.THREE_DAYS_SECONDS:
                logger.info(
                    "pending=%s (age=%ds) -- skipping cycle", pending["mac"], elapsed
                )
                _emit({"wakeAgent": False})
                return 0
            led.clear_pending(conn, pending["mac"])
            logger.info(
                "pending=%s timed out (age=%ds) -- cleared", pending["mac"], elapsed
            )

        rows = conn.execute(
            "SELECT mac, last_asked_at, pending, dismissed FROM intake"
        ).fetchall()
        ledger_state = {
            r["mac"]: {
                "last_asked_at": r["last_asked_at"],
                "pending": r["pending"],
                "dismissed": r["dismissed"],
            }
            for r in rows
        }

        pick = flt.pick_candidate(devices, ledger_state, now)
        if pick is None:
            logger.info("candidates=0 -- no device to ping")
            _emit({"wakeAgent": False})
            return 0

        mac = pick["devMac"]
        logger.info("candidate=%s (dry_run=%s)", mac, args.dry_run)

        if not args.dry_run:
            led.mark_pending(conn, mac, now)

        _emit(
            {
                "wakeAgent": True,
                "data": {
                    "device": {
                        "mac": mac,
                        "ip": pick.get("devLastIP", ""),
                        "vendor": pick.get("devVendor", ""),
                        "name_hint": pick.get("devName", ""),
                        "firstSeen": pick.get("devFirstConnection", ""),
                        "lastSeen": pick.get("devLastConnection", ""),
                        "netalertx_url": f"http://netalertx.home.lan/deviceDetails.php?mac={mac}",
                    }
                },
            }
        )
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
