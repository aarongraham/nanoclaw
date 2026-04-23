"""Thin NetAlertX REST client using stdlib only."""
import json
import urllib.error
import urllib.request
from typing import Any, Optional


class NetAlertXError(Exception):
    pass


def _request(method: str, url: str, token: str, body: Optional[dict] = None) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        raise NetAlertXError(f"{method} {url} -> HTTP {e.code}") from e
    except urllib.error.URLError as e:
        raise NetAlertXError(f"{method} {url} -> {e.reason}") from e
    if not raw:
        return None
    return json.loads(raw)


def get_devices(base_url: str, token: str) -> list:
    result = _request("GET", f"{base_url}/devices", token)
    # NetAlertX may return either a bare list or {"data": [...]} depending on version.
    if isinstance(result, dict) and "data" in result:
        return result["data"]
    return result or []


def update_column(base_url: str, token: str, mac: str, column: str, value: str) -> None:
    _request(
        "POST",
        f"{base_url}/device/{mac}/update-column",
        token,
        {"columnName": column, "columnValue": value},
    )


def lock_field(base_url: str, token: str, mac: str, field: str) -> None:
    _request(
        "POST",
        f"{base_url}/device/{mac}/field/lock",
        token,
        {"fieldName": field, "lock": True},
    )
