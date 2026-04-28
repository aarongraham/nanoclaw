import importlib
import io
import json
import sys
from pathlib import Path
from unittest.mock import patch


def _import_apply():
    skill_root = str(Path(__file__).parent.parent)
    if skill_root not in sys.path:
        sys.path.insert(0, skill_root)
    if "apply" in sys.modules:
        importlib.reload(sys.modules["apply"])
    else:
        import apply  # noqa: F401
    return sys.modules["apply"]


def _run(stdin: str):
    apply_mod = _import_apply()
    with patch("sys.stdin", io.StringIO(stdin)):
        buf = io.StringIO()
        with patch("sys.stdout", buf):
            rc = apply_mod.main([])
    return rc, buf.getvalue()


BASE_INPUT = json.dumps(
    {
        "mac": "AA:BB:CC:DD:EE:FF",
        "name": "fleur-iphone",
        "owner": "Fleur",
        "type": "Phone",
        "location": "Fleur's iPhone",
        "group_id": 1,
        "pihole_comment": "fleur-iphone [Fleur's iPhone]",
    }
)


@patch("lib.pihole.upsert_client")
@patch("lib.netalertx.lock_field")
@patch("lib.netalertx.update_column")
def test_happy_path_both_ok(mock_uc, mock_lock, mock_up):
    rc, out = _run(BASE_INPUT)
    assert rc == 0
    result = json.loads(out)
    assert result == {"netalertx": "ok", "pihole": "ok"}

    columns_set = {c.args[3] for c in mock_uc.call_args_list}
    assert {"devName", "devOwner", "devType", "devLocation"} <= columns_set
    mock_lock.assert_called_once()
    mock_up.assert_called_once()


@patch("lib.pihole.upsert_client", side_effect=Exception("network fail"))
@patch("lib.netalertx.lock_field")
@patch("lib.netalertx.update_column")
def test_pihole_fails_netalertx_still_ok(mock_uc, mock_lock, mock_up):
    rc, out = _run(BASE_INPUT)
    assert rc == 0
    result = json.loads(out)
    assert result["netalertx"] == "ok"
    assert result["pihole"].startswith("failed:")


@patch("lib.pihole.upsert_client")
@patch("lib.netalertx.lock_field")
@patch("lib.netalertx.update_column", side_effect=Exception("nax fail"))
def test_netalertx_fails_pihole_still_attempted(mock_uc, mock_lock, mock_up):
    rc, out = _run(BASE_INPUT)
    assert rc == 0
    result = json.loads(out)
    assert result["netalertx"].startswith("failed:")
    mock_up.assert_called_once()


def test_malformed_input_exits_nonzero():
    rc, _ = _run("not json at all")
    assert rc == 1


def test_missing_required_fields_exits_nonzero():
    rc, _ = _run(json.dumps({"mac": "AA:BB:CC:DD:EE:FF"}))
    assert rc == 1


@patch("lib.pihole.upsert_client")
@patch("lib.netalertx.lock_field")
@patch("lib.netalertx.update_column")
def test_empty_optional_fields_skips_update(mock_uc, mock_lock, mock_up):
    input_json = json.dumps(
        {
            "mac": "AA:BB:CC:DD:EE:FF",
            "name": "test",
            "owner": "",
            "type": "",
            "location": "",
            "group_id": 0,
            "pihole_comment": "test",
        }
    )
    rc, out = _run(input_json)
    assert rc == 0
    columns_set = {c.args[3] for c in mock_uc.call_args_list}
    assert columns_set == {"devName"}
    mock_lock.assert_called_once()
