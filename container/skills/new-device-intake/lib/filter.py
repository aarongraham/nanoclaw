"""Pure logic for picking the next device to ping about."""
from datetime import datetime
from typing import Any, Optional

THREE_DAYS_SECONDS = 3 * 24 * 3600


def parse_netalertx_timestamp(s: Any) -> int:
    """Parse NetAlertX 'YYYY-MM-DD HH:MM:SS' into unix epoch. Returns 0 on bad input."""
    if not s or not isinstance(s, str):
        return 0
    try:
        return int(datetime.strptime(s, "%Y-%m-%d %H:%M:%S").timestamp())
    except (ValueError, OverflowError):
        return 0


def _is_unlabeled(dev: dict) -> bool:
    if dev.get("devIsNew") != 1:
        return False
    if dev.get("devOwner", "") != "":
        return False
    if dev.get("devLocation", "") != "":
        return False
    if dev.get("devComments", "") != "":
        return False
    if dev.get("devNameSource") in ("USER", "LOCKED"):
        return False
    return True


def _ledger_allows(dev: dict, ledger_rows: dict, now: int) -> bool:
    row = ledger_rows.get(dev["devMac"])
    if row is None:
        return True
    if row.get("dismissed") == 1:
        return False
    elapsed = now - row.get("last_asked_at", 0)
    if elapsed < THREE_DAYS_SECONDS:
        return False
    last_conn = parse_netalertx_timestamp(dev.get("devLastConnection"))
    if last_conn <= row.get("last_asked_at", 0):
        return False
    return True


def pick_candidate(devices: list, ledger_rows: dict, now: int) -> Optional[dict]:
    """Return the single device to ping about this cycle, or None.

    `ledger_rows` is a dict keyed by MAC with values {last_asked_at, pending, dismissed}.
    `now` is unix epoch.
    """
    candidates = [d for d in devices if _is_unlabeled(d) and _ledger_allows(d, ledger_rows, now)]
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda d: parse_netalertx_timestamp(d.get("devFirstConnection")) or 2**31,
    )
