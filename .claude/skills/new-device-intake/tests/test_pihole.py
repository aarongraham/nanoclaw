import json
import urllib.error
from unittest.mock import MagicMock, patch

import pytest

from lib import pihole

BASE = "http://pihole.example:8053/api"


def _mock_response(payload, status=200):
    resp = MagicMock()
    resp.read.return_value = json.dumps(payload).encode()
    resp.status = status
    resp.__enter__.return_value = resp
    resp.__exit__.return_value = False
    return resp


@patch("lib.pihole.urllib.request.urlopen")
def test_list_groups(mock_open):
    mock_open.return_value = _mock_response(
        {"groups": [{"id": 0, "name": "Default"}, {"id": 1, "name": "Ad Blocking"}]}
    )
    groups = pihole.list_groups(BASE)
    assert groups == [{"id": 0, "name": "Default"}, {"id": 1, "name": "Ad Blocking"}]


@patch("lib.pihole.urllib.request.urlopen")
def test_upsert_client_posts_on_first_try(mock_open):
    mock_open.return_value = _mock_response({"ok": True})
    pihole.upsert_client(BASE, "AA:BB:CC:DD:EE:FF", 1, "fleur-iphone [Fleur's iPhone]")

    req = mock_open.call_args.args[0]
    assert req.full_url == f"{BASE}/clients"
    assert req.method == "POST"
    body = json.loads(req.data.decode())
    assert body == {
        "client": "AA:BB:CC:DD:EE:FF",
        "groups": [1],
        "comment": "fleur-iphone [Fleur's iPhone]",
    }


@patch("lib.pihole.urllib.request.urlopen")
def test_upsert_client_falls_back_to_put_on_conflict(mock_open):
    err = urllib.error.HTTPError(f"{BASE}/clients", 409, "Conflict", {}, None)
    ok_resp = _mock_response({"ok": True})
    mock_open.side_effect = [err, ok_resp]

    pihole.upsert_client(BASE, "AA:BB:CC:DD:EE:FF", 2, "kitchen-hvac")

    assert mock_open.call_count == 2
    put_req = mock_open.call_args_list[1].args[0]
    assert put_req.method == "PUT"
    assert put_req.full_url == f"{BASE}/clients/AA%3ABB%3ACC%3ADD%3AEE%3AFF"
    body = json.loads(put_req.data.decode())
    assert body == {"groups": [2], "comment": "kitchen-hvac"}


@patch("lib.pihole.urllib.request.urlopen")
def test_upsert_client_falls_back_to_put_on_400(mock_open):
    # Pi-hole v6 sometimes returns 400 instead of 409 for "already exists"
    err = urllib.error.HTTPError(f"{BASE}/clients", 400, "Bad Request", {}, None)
    ok_resp = _mock_response({"ok": True})
    mock_open.side_effect = [err, ok_resp]

    pihole.upsert_client(BASE, "AA:BB:CC:DD:EE:FF", 2, "x")
    assert mock_open.call_count == 2
    assert mock_open.call_args_list[1].args[0].method == "PUT"


@patch("lib.pihole.urllib.request.urlopen")
def test_upsert_client_raises_on_non_conflict_error(mock_open):
    mock_open.side_effect = urllib.error.HTTPError(
        f"{BASE}/clients", 500, "Server Error", {}, None
    )
    with pytest.raises(pihole.PiHoleError):
        pihole.upsert_client(BASE, "AA:BB:CC:DD:EE:FF", 1, "x")


@patch("lib.pihole.urllib.request.urlopen")
def test_list_groups_raises_on_url_error(mock_open):
    mock_open.side_effect = urllib.error.URLError("connection refused")
    with pytest.raises(pihole.PiHoleError):
        pihole.list_groups(BASE)
