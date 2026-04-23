import pytest

from lib import ledger


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "test.db"
    conn = ledger.open_db(str(path))
    yield conn
    conn.close()


def test_open_db_creates_schema(db):
    rows = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    assert [r[0] for r in rows] == ["intake", "meta"]


def test_open_db_is_idempotent(tmp_path):
    path = str(tmp_path / "test.db")
    ledger.open_db(path).close()
    ledger.open_db(path).close()


def test_get_pending_returns_none_when_empty(db):
    assert ledger.get_pending(db) is None


def test_mark_pending_and_get_pending(db):
    ledger.mark_pending(db, "AA:BB:CC:DD:EE:FF", now=1700000000)
    row = ledger.get_pending(db)
    assert row is not None
    assert row["mac"] == "AA:BB:CC:DD:EE:FF"
    assert row["last_asked_at"] == 1700000000
    assert row["pending"] == 1


def test_clear_pending(db):
    ledger.mark_pending(db, "AA:BB:CC:DD:EE:FF", now=1700000000)
    ledger.clear_pending(db, "AA:BB:CC:DD:EE:FF")
    assert ledger.get_pending(db) is None


def test_mark_dismissed_sets_flag_and_clears_pending(db):
    ledger.mark_pending(db, "AA:BB:CC:DD:EE:FF", now=1700000000)
    ledger.mark_dismissed(db, "AA:BB:CC:DD:EE:FF")
    row = db.execute(
        "SELECT pending, dismissed FROM intake WHERE mac=?",
        ("AA:BB:CC:DD:EE:FF",),
    ).fetchone()
    assert row["pending"] == 0
    assert row["dismissed"] == 1


def test_get_mac_state_for_unknown(db):
    assert ledger.get_mac_state(db, "11:22:33:44:55:66") is None


def test_get_mac_state_after_pending(db):
    ledger.mark_pending(db, "AA:BB:CC:DD:EE:FF", now=1700000000)
    st = ledger.get_mac_state(db, "AA:BB:CC:DD:EE:FF")
    assert st["pending"] == 1
    assert st["dismissed"] == 0


def test_meta_set_and_get(db):
    ledger.set_meta(db, "schedule_task_id", "abc123")
    assert ledger.get_meta(db, "schedule_task_id") == "abc123"


def test_meta_get_missing(db):
    assert ledger.get_meta(db, "nope") is None


def test_meta_set_overwrites(db):
    ledger.set_meta(db, "k", "v1")
    ledger.set_meta(db, "k", "v2")
    assert ledger.get_meta(db, "k") == "v2"
