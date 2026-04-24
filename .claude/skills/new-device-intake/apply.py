#!/usr/bin/env python3
"""Apply labels to NetAlertX + Pi-hole. Called by the intake agent after parsing a reply.

Reads one JSON object from stdin, writes one JSON result object to stdout.
Exit 0 for any run where input parsed (partial failures are reported in-band).
Exit 1 only for malformed input / missing required fields.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from lib import netalertx  # noqa: E402
from lib import pihole  # noqa: E402

DEFAULT_NETALERTX = "http://192.168.42.11:20212"
DEFAULT_PIHOLE = "http://192.168.42.11:8053/api"


def _apply_netalertx(base, token, req):
    mac = req["mac"]
    fields = [
        ("devName", req.get("name", "")),
        ("devOwner", req.get("owner", "")),
        ("devType", req.get("type", "")),
        ("devLocation", req.get("location", "")),
    ]
    for column, value in fields:
        if value:
            netalertx.update_column(base, token, mac, column, value)
    # Always lock devName (even if name was empty — locking an already-named
    # field is idempotent and protects against PHOLAPI stomping later renames).
    netalertx.lock_field(base, token, mac, "devName")


def _apply_pihole(base, req):
    pihole.upsert_client(
        base,
        req["mac"],
        req["group_id"],
        req.get("pihole_comment", req.get("name", "")),
    )


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--netalertx-base",
        default=os.environ.get("NETALERTX_BASE", DEFAULT_NETALERTX),
    )
    p.add_argument(
        "--pihole-base",
        default=os.environ.get("PIHOLE_BASE", DEFAULT_PIHOLE),
    )
    args = p.parse_args(argv)

    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
    except json.JSONDecodeError:
        sys.stderr.write("apply.py: input is not valid JSON\n")
        return 1
    required = {"mac", "group_id"}
    missing = required - req.keys()
    if missing:
        sys.stderr.write(f"apply.py: missing required fields {missing}\n")
        return 1

    token = os.environ.get("NETALERTX_API_TOKEN", "")
    result = {"netalertx": "ok", "pihole": "ok"}

    try:
        _apply_netalertx(args.netalertx_base, token, req)
    except Exception as e:
        result["netalertx"] = f"failed: {e}"

    try:
        _apply_pihole(args.pihole_base, req)
    except Exception as e:
        result["pihole"] = f"failed: {e}"

    sys.stdout.write(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
