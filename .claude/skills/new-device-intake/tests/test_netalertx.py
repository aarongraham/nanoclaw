import json
import urllib.error
from unittest.mock import MagicMock, patch

import pytest

from lib import netalertx

BASE = "http://netalertx.example:20212"
TOKEN = "test-token"


def _mock_response(payload, status=200):
    resp = MagicMock()
    resp.read.return_value = json.dumps(payload).encode()
    resp.status = status
    resp.__enter__.return_value = resp
    resp.__exit__.return_value = False
    return resp


@patch("lib.netalertx.urllib.request.urlopen")
def test_get_devices_returns_parsed_list(mock_open):
    mock_open.return_value = _mock_response([{"devMac": "AA:BB:CC:DD:EE:FF"}])
    devices = netalertx.get_devices(BASE, TOKEN)
    assert devices == [{"devMac": "AA:BB:CC:DD:EE:FF"}]

    req = mock_open.call_args.args[0]
    assert req.full_url == f"{BASE}/devices"
    # Headers are canonicalized to title-case by urllib
    assert req.get_header("Authorization") == f"Bearer {TOKEN}"


@patch("lib.netalertx.urllib.request.urlopen")
def test_get_devices_handles_dict_envelope(mock_open):
    mock_open.return_value = _mock_response({"data": [{"devMac": "AA"}]})
    assert netalertx.get_devices(BASE, TOKEN) == [{"devMac": "AA"}]


@patch("lib.netalertx.urllib.request.urlopen")
def test_update_column_posts_correct_body(mock_open):
    mock_open.return_value = _mock_response({"ok": True})
    netalertx.update_column(BASE, TOKEN, "AA:BB:CC:DD:EE:FF", "devName", "fleur-iphone")

    req = mock_open.call_args.args[0]
    assert req.full_url == f"{BASE}/device/AA:BB:CC:DD:EE:FF/update-column"
    assert req.method == "POST"
    body = json.loads(req.data.decode())
    assert body == {"columnName": "devName", "columnValue": "fleur-iphone"}


@patch("lib.netalertx.urllib.request.urlopen")
def test_lock_field_posts_correct_body(mock_open):
    mock_open.return_value = _mock_response({"ok": True})
    netalertx.lock_field(BASE, TOKEN, "AA:BB:CC:DD:EE:FF", "devName")

    req = mock_open.call_args.args[0]
    assert req.full_url == f"{BASE}/device/AA:BB:CC:DD:EE:FF/field/lock"
    body = json.loads(req.data.decode())
    assert body == {"fieldName": "devName", "lock": True}


@patch("lib.netalertx.urllib.request.urlopen")
def test_get_devices_raises_on_http_error(mock_open):
    mock_open.side_effect = urllib.error.HTTPError(
        f"{BASE}/devices", 500, "Server Error", {}, None
    )
    with pytest.raises(netalertx.NetAlertXError):
        netalertx.get_devices(BASE, TOKEN)


@patch("lib.netalertx.urllib.request.urlopen")
def test_get_devices_raises_on_url_error(mock_open):
    mock_open.side_effect = urllib.error.URLError("connection refused")
    with pytest.raises(netalertx.NetAlertXError):
        netalertx.get_devices(BASE, TOKEN)
