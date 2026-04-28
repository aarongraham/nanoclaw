#!/usr/bin/env python3
"""Preflight checks for /install-new-device-intake.

Run on the NanoClaw host (typically claw.home.lan) before installing.
Verifies NetAlertX + Pi-hole are reachable and Pi-hole has the expected
group structure (IDs 0-3) the reply-alias table assumes.

Exits 0 on success, 1 on any failure with the failure list on stderr.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Optional


def _check_http(url: str, token: Optional[str] = None) -> Optional[str]:
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status != 200:
                return f"{url} returned HTTP {resp.status}"
        return None
    except urllib.error.HTTPError as e:
        return f"{url} returned HTTP {e.code}"
    except urllib.error.URLError as e:
        return f"{url} unreachable: {e.reason}"


def _check_pihole_groups() -> Optional[str]:
    url = os.environ.get("PIHOLE_BASE", "http://192.168.42.11:8053/api") + "/groups"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            body = json.loads(resp.read())
    except Exception as e:
        return f"Pi-hole groups unreachable: {e}"
    groups = body.get("groups", body if isinstance(body, list) else [])
    ids = {g.get("id") for g in groups}
    missing = {0, 1, 2, 3} - ids
    if missing:
        return f"Pi-hole missing group IDs: {sorted(missing)}"
    return None


def main() -> int:
    failures = []

    base = os.environ.get("NETALERTX_BASE", "http://192.168.42.11:20212")
    token = os.environ.get("NETALERTX_API_TOKEN", "")
    if not token:
        failures.append("NETALERTX_API_TOKEN env var is empty (set in nanoclaw .env)")
    else:
        err = _check_http(f"{base}/devices", token)
        if err:
            failures.append(f"NetAlertX: {err}")

    err = _check_pihole_groups()
    if err:
        failures.append(err)

    if failures:
        sys.stderr.write("Preflight failed:\n")
        for f in failures:
            sys.stderr.write(f"  - {f}\n")
        return 1

    print("preflight: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
