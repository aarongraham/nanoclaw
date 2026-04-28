"""Intake ledger -- SQLite wrapper. Tracks pending/asked/dismissed state per MAC."""
import sqlite3
from typing import Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS intake (
  mac            TEXT PRIMARY KEY,
  last_asked_at  INTEGER NOT NULL,
  pending        INTEGER NOT NULL DEFAULT 0,
  dismissed      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""


def open_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def get_pending(conn: sqlite3.Connection) -> Optional[sqlite3.Row]:
    return conn.execute(
        "SELECT mac, last_asked_at, pending, dismissed FROM intake WHERE pending=1 LIMIT 1"
    ).fetchone()


def get_mac_state(conn: sqlite3.Connection, mac: str) -> Optional[sqlite3.Row]:
    return conn.execute(
        "SELECT mac, last_asked_at, pending, dismissed FROM intake WHERE mac=?",
        (mac,),
    ).fetchone()


def mark_pending(conn: sqlite3.Connection, mac: str, now: int) -> None:
    conn.execute(
        """INSERT INTO intake(mac, last_asked_at, pending, dismissed)
           VALUES(?, ?, 1, 0)
           ON CONFLICT(mac) DO UPDATE SET last_asked_at=excluded.last_asked_at, pending=1""",
        (mac, now),
    )
    conn.commit()


def clear_pending(conn: sqlite3.Connection, mac: str) -> None:
    conn.execute("UPDATE intake SET pending=0 WHERE mac=?", (mac,))
    conn.commit()


def mark_dismissed(conn: sqlite3.Connection, mac: str) -> None:
    conn.execute(
        "UPDATE intake SET pending=0, dismissed=1 WHERE mac=?",
        (mac,),
    )
    conn.commit()


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """INSERT INTO meta(key, value) VALUES(?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
        (key, value),
    )
    conn.commit()


def get_meta(conn: sqlite3.Connection, key: str) -> Optional[str]:
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None
