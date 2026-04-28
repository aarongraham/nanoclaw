import importlib
import io
import json
import sys
from pathlib import Path
from unittest.mock import patch

from lib import ledger


def _import_poll():
    skill_root = str(Path(__file__).parent.parent)
    if skill_root not in sys.path:
        sys.path.insert(0, skill_root)
    if "poll" in sys.modules:
        importlib.reload(sys.modules["poll"])
    else:
        import poll  # noqa: F401
    return sys.modules["poll"]


def _run_poll(tmp_path, monkeypatch, devices, extra_args=()):
    poll = _import_poll()
    ledger_path = str(tmp_path / "ledger.db")
    log_path = str(tmp_path / "poll.log")
    monkeypatch.setenv("NETALERTX_BASE", "http://nax.test:20212")
    monkeypatch.setenv("NETALERTX_API_TOKEN", "t")

    with patch("lib.netalertx.get_devices", return_value=devices):
        buf = io.StringIO()
        with patch("sys.stdout", buf):
            rc = poll.main(
                ["--ledger", ledger_path, "--log", log_path, *extra_args]
            )
    return rc, buf.getvalue(), ledger_path, log_path


def _device(mac, **overrides):
    base = {
        "devMac": mac,
        "devIsNew": 1,
        "devOwner": "",
        "devLocation": "",
        "devComments": "",
        "devNameSource": "PHOLAPI",
        "devLastIP": "192.168.42.100",
        "devVendor": "Apple, Inc.",
        "devName": "iPad",
        "devFirstConnection": "2026-04-22 14:00:00",
        "devLastConnection": "2026-04-22 14:30:00",
    }
    base.update(overrides)
    return base


def test_no_qualifying_devices_emits_wakeAgent_false(tmp_path, monkeypatch):
    rc, out, _, _ = _run_poll(tmp_path, monkeypatch, devices=[])
    assert rc == 0
    payload = json.loads(out.strip())
    assert payload == {"wakeAgent": False}


def test_qualifying_device_emits_wakeAgent_true_and_writes_ledger(tmp_path, monkeypatch):
    devs = [_device("AA:BB:CC:DD:EE:FF")]
    rc, out, ledger_path, _ = _run_poll(tmp_path, monkeypatch, devices=devs)
    assert rc == 0
    payload = json.loads(out.strip())
    assert payload["wakeAgent"] is True
    assert payload["data"]["device"]["mac"] == "AA:BB:CC:DD:EE:FF"
    assert payload["data"]["device"]["ip"] == "192.168.42.100"
    assert payload["data"]["device"]["vendor"] == "Apple, Inc."

    conn = ledger.open_db(ledger_path)
    row = ledger.get_pending(conn)
    assert row["mac"] == "AA:BB:CC:DD:EE:FF"
    conn.close()


def test_pending_within_3_days_skips_cycle(tmp_path, monkeypatch):
    conn = ledger.open_db(str(tmp_path / "ledger.db"))
    ledger.mark_pending(conn, "AA:BB:CC:DD:EE:FF", now=9999999999)
    conn.close()

    devs = [_device("BB:BB:BB:BB:BB:BB")]
    rc, out, _, _ = _run_poll(tmp_path, monkeypatch, devices=devs)
    payload = json.loads(out.strip())
    assert payload == {"wakeAgent": False}


def test_dry_run_does_not_write_ledger(tmp_path, monkeypatch):
    devs = [_device("AA:BB:CC:DD:EE:FF")]
    rc, out, ledger_path, _ = _run_poll(
        tmp_path, monkeypatch, devices=devs, extra_args=("--dry-run",)
    )
    assert rc == 0
    payload = json.loads(out.strip())
    assert payload["wakeAgent"] is True

    conn = ledger.open_db(ledger_path)
    assert ledger.get_pending(conn) is None
    conn.close()


def test_netalertx_unreachable_emits_wakeAgent_false(tmp_path, monkeypatch):
    poll = _import_poll()
    monkeypatch.setenv("NETALERTX_BASE", "http://nax.test:20212")
    monkeypatch.setenv("NETALERTX_API_TOKEN", "t")

    from lib import netalertx
    with patch("lib.netalertx.get_devices", side_effect=netalertx.NetAlertXError("boom")):
        buf = io.StringIO()
        with patch("sys.stdout", buf):
            rc = poll.main(
                ["--ledger", str(tmp_path / "l.db"), "--log", str(tmp_path / "l.log")]
            )
    payload = json.loads(buf.getvalue().strip())
    assert rc == 0
    assert payload == {"wakeAgent": False}


def test_missing_token_emits_wakeAgent_false(tmp_path, monkeypatch):
    poll = _import_poll()
    monkeypatch.setenv("NETALERTX_BASE", "http://nax.test:20212")
    monkeypatch.delenv("NETALERTX_API_TOKEN", raising=False)

    buf = io.StringIO()
    with patch("sys.stdout", buf):
        rc = poll.main(
            ["--ledger", str(tmp_path / "l.db"), "--log", str(tmp_path / "l.log")]
        )
    assert rc == 0
    assert json.loads(buf.getvalue().strip()) == {"wakeAgent": False}


def test_log_file_is_written(tmp_path, monkeypatch):
    _, _, _, log_path = _run_poll(tmp_path, monkeypatch, devices=[])
    assert Path(log_path).exists()
    content = Path(log_path).read_text()
    assert "candidates=0" in content


def test_pending_older_than_3_days_is_cleared_and_new_candidate_taken(tmp_path, monkeypatch):
    old_ts = 1_700_000_000 - 5 * 24 * 3600
    ledger_path = str(tmp_path / "ledger.db")
    conn = ledger.open_db(ledger_path)
    ledger.mark_pending(conn, "AA:AA:AA:AA:AA:AA", now=old_ts)
    conn.close()

    poll = _import_poll()
    monkeypatch.setenv("NETALERTX_BASE", "http://nax.test:20212")
    monkeypatch.setenv("NETALERTX_API_TOKEN", "t")

    devs = [_device("BB:BB:BB:BB:BB:BB")]
    with patch("lib.netalertx.get_devices", return_value=devs):
        with patch("poll.time.time", return_value=1_700_000_000):
            buf = io.StringIO()
            with patch("sys.stdout", buf):
                rc = poll.main(
                    ["--ledger", ledger_path, "--log", str(tmp_path / "l.log")]
                )
    payload = json.loads(buf.getvalue().strip())
    assert rc == 0
    assert payload["wakeAgent"] is True
    assert payload["data"]["device"]["mac"] == "BB:BB:BB:BB:BB:BB"

    conn = ledger.open_db(ledger_path)
    old = ledger.get_mac_state(conn, "AA:AA:AA:AA:AA:AA")
    assert old["pending"] == 0
    new = ledger.get_mac_state(conn, "BB:BB:BB:BB:BB:BB")
    assert new["pending"] == 1
    conn.close()
