from lib import filter as flt


def dev(mac="AA:BB:CC:DD:EE:FF", **overrides):
    base = {
        "devMac": mac,
        "devIsNew": 1,
        "devOwner": "",
        "devLocation": "",
        "devComments": "",
        "devNameSource": "PHOLAPI",
        "devLastIP": "192.168.42.100",
        "devVendor": "Apple, Inc.",
        "devName": "iPad-de-Francesca",
        "devFirstConnection": "2026-04-22 14:03:00",
        "devLastConnection": "2026-04-22 14:30:00",
    }
    base.update(overrides)
    return base


def test_picks_qualifying_device_when_ledger_empty():
    result = flt.pick_candidate([dev()], ledger_rows={}, now=1700000000)
    assert result is not None
    assert result["devMac"] == "AA:BB:CC:DD:EE:FF"


def test_rejects_devIsNew_zero():
    result = flt.pick_candidate([dev(devIsNew=0)], ledger_rows={}, now=1700000000)
    assert result is None


def test_rejects_when_owner_set():
    result = flt.pick_candidate([dev(devOwner="Aaron")], ledger_rows={}, now=1700000000)
    assert result is None


def test_rejects_when_location_set():
    result = flt.pick_candidate([dev(devLocation="kitchen")], ledger_rows={}, now=1700000000)
    assert result is None


def test_rejects_when_comments_set():
    result = flt.pick_candidate([dev(devComments="some note")], ledger_rows={}, now=1700000000)
    assert result is None


def test_rejects_when_name_source_is_user():
    result = flt.pick_candidate([dev(devNameSource="USER")], ledger_rows={}, now=1700000000)
    assert result is None


def test_rejects_when_name_source_is_locked():
    result = flt.pick_candidate([dev(devNameSource="LOCKED")], ledger_rows={}, now=1700000000)
    assert result is None


def test_rejects_dismissed_mac():
    ledger_rows = {"AA:BB:CC:DD:EE:FF": {"last_asked_at": 0, "pending": 0, "dismissed": 1}}
    result = flt.pick_candidate([dev()], ledger_rows=ledger_rows, now=1700000000)
    assert result is None


def test_rejects_when_recently_asked():
    one_day_ago = 1700000000 - 24 * 3600
    ledger_rows = {
        "AA:BB:CC:DD:EE:FF": {"last_asked_at": one_day_ago, "pending": 0, "dismissed": 0}
    }
    result = flt.pick_candidate([dev()], ledger_rows=ledger_rows, now=1700000000)
    assert result is None


def test_rejects_when_device_not_reconnected_since_last_ask():
    two_days_ago = 1700000000 - 2 * 24 * 3600
    ledger_rows = {
        "AA:BB:CC:DD:EE:FF": {
            "last_asked_at": two_days_ago,
            "pending": 0,
            "dismissed": 0,
        }
    }
    d = dev(devLastConnection="2020-01-01 00:00:00")
    result = flt.pick_candidate([d], ledger_rows=ledger_rows, now=1700000000 + 2 * 24 * 3600)
    assert result is None


def test_accepts_when_3_days_and_reconnected():
    four_days_ago = 1700000000 - 4 * 24 * 3600
    one_day_ago_ts = 1700000000 - 24 * 3600
    from datetime import datetime
    last_conn_str = datetime.fromtimestamp(one_day_ago_ts).strftime("%Y-%m-%d %H:%M:%S")

    ledger_rows = {
        "AA:BB:CC:DD:EE:FF": {"last_asked_at": four_days_ago, "pending": 0, "dismissed": 0}
    }
    d = dev(devLastConnection=last_conn_str)
    result = flt.pick_candidate([d], ledger_rows=ledger_rows, now=1700000000)
    assert result is not None


def test_picks_oldest_firstConnection_when_multiple_qualify():
    older = dev(mac="AA:AA:AA:AA:AA:AA", devFirstConnection="2026-04-20 10:00:00")
    newer = dev(mac="BB:BB:BB:BB:BB:BB", devFirstConnection="2026-04-22 14:00:00")
    result = flt.pick_candidate([newer, older], ledger_rows={}, now=1700000000)
    assert result["devMac"] == "AA:AA:AA:AA:AA:AA"


def test_returns_none_on_empty_list():
    assert flt.pick_candidate([], ledger_rows={}, now=1700000000) is None


def test_parse_netalertx_timestamp_handles_standard_format():
    ts = flt.parse_netalertx_timestamp("2026-04-22 14:30:00")
    assert ts > 1700000000


def test_parse_netalertx_timestamp_returns_zero_on_garbage():
    assert flt.parse_netalertx_timestamp("") == 0
    assert flt.parse_netalertx_timestamp(None) == 0
    assert flt.parse_netalertx_timestamp("nonsense") == 0
