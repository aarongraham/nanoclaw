"""Reply classifier, group-alias resolver, and name parser."""
import re
from typing import Optional

# Aliases for Pi-hole group IDs (see docs/pihole-api-reference.md §"Current Group Structure").
# Order matters: IoT is matched before "personal" so "iot" doesn't get swallowed by the
# ad-blocking pattern, and specific two-word aliases are matched before one-word ones.
_GROUP_ALIASES = [
    (re.compile(r"\b(iot blocked|block iot|smart home|iot)\b", re.I), 2),
    (re.compile(r"\b(ad blocking|block ads|personal|ads)\b", re.I), 1),
    (re.compile(r"\b(unrestricted|don'?t block|allow all|allow|bypass)\b", re.I), 3),
    (re.compile(r"\b(no blocking|skip blocking|default|none)\b", re.I), 0),
]

_SKIP_RE = re.compile(r"^\s*(skip|not now)\b", re.I)
_IGNORE_RE = re.compile(r"^\s*(ignore|not mine)\b", re.I)
_POSSESSIVE_RE = re.compile(r"\b([A-Z][a-z]+)'s\b")


def classify_intent(text: str) -> str:
    if not text or not text.strip():
        return "ambiguous"
    if _SKIP_RE.search(text):
        return "skip"
    if _IGNORE_RE.search(text):
        return "ignore"
    # A reply is a "label" if it contains a recognized group alias OR it has enough
    # substance (>=2 words) that we should at least try to parse a name from it.
    if resolve_group(text) is not None:
        return "label"
    if len(text.strip().split()) >= 2:
        return "label"
    return "ambiguous"


def resolve_group(text: str) -> Optional[int]:
    for pattern, gid in _GROUP_ALIASES:
        if pattern.search(text):
            return gid
    return None


def parse_label(text: str) -> dict:
    """Parse 'Fleur's iPhone, ad blocking' into {name, group, owner, type}."""
    group = resolve_group(text)
    name_part = text

    # Strip the matched alias out of the text before extracting the name,
    # so "ad blocking" doesn't end up inside the hyphenated name.
    if group is not None:
        for pattern, gid in _GROUP_ALIASES:
            if gid == group:
                name_part = pattern.sub("", name_part, count=1)
                break

    name_part = name_part.strip().strip(",").strip()

    # Capture owner from "Fleur's" style possessives before we lowercase.
    owner_match = _POSSESSIVE_RE.search(name_part)
    owner = owner_match.group(1) if owner_match else ""

    # Normalize the name: lowercase, strip possessive 's, non-alnum to space, collapse to hyphens.
    normalized = name_part.lower()
    normalized = re.sub(r"\b([a-z]+)'s\b", r"\1", normalized)
    normalized = re.sub(r"[^a-z0-9\s-]", "", normalized)
    normalized = re.sub(r"\s+", "-", normalized).strip("-")

    return {
        "name": normalized,
        "group": group,
        "owner": owner,
        "type": "",  # agent may infer from vendor/name separately
    }
