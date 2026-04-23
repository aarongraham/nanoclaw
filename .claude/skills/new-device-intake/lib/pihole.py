"""Thin Pi-hole v6 REST client using stdlib only. Assumes empty password."""
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional


class PiHoleError(Exception):
    pass


def _request(method: str, url: str, body: Optional[dict] = None) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
    except urllib.error.URLError as e:
        if isinstance(e, urllib.error.HTTPError):
            # Let callers branch on .code (e.g. 400/409 -> PUT fallback).
            raise
        raise PiHoleError(f"{method} {url} -> {e.reason}") from e
    if not raw:
        return None
    return json.loads(raw)


def list_groups(base_url: str) -> list:
    try:
        result = _request("GET", f"{base_url}/groups")
    except urllib.error.HTTPError as e:
        raise PiHoleError(f"GET groups -> HTTP {e.code}") from e
    if isinstance(result, dict) and "groups" in result:
        return result["groups"]
    return result or []


def upsert_client(base_url: str, mac: str, group_id: int, comment: str) -> None:
    try:
        _request(
            "POST",
            f"{base_url}/clients",
            {"client": mac, "groups": [group_id], "comment": comment},
        )
    except urllib.error.HTTPError as e:
        if e.code in (400, 409):
            mac_enc = urllib.parse.quote(mac, safe="")
            try:
                _request(
                    "PUT",
                    f"{base_url}/clients/{mac_enc}",
                    {"groups": [group_id], "comment": comment},
                )
            except urllib.error.HTTPError as e2:
                raise PiHoleError(f"PUT clients/{mac} -> HTTP {e2.code}") from e2
        else:
            raise PiHoleError(f"POST clients -> HTTP {e.code}") from e
