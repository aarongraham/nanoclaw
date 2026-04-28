#!/usr/bin/env python3
"""Initialize the intake ledger DB if it doesn't exist.

Default location: groups/dm-with-aaron/data/new-device-intake.db on the
NanoClaw host. That maps to /workspace/agent/data/new-device-intake.db
inside the agent container via the V2 agent-group mount.

Reuses the ledger module from the sibling container skill (sister to the
SKILL.md / poll.py / apply.py) so the schema lives in one place.
"""
import sys
from pathlib import Path

# Reuse the lib/ledger.py implementation from the sibling container skill.
SKILL_DIR = Path(__file__).resolve().parents[2] / "container" / "skills" / "new-device-intake"
sys.path.insert(0, str(SKILL_DIR))

from lib import ledger  # noqa: E402

DEFAULT_PATH = "groups/dm-with-aaron/data/new-device-intake.db"


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = ledger.open_db(path)
    conn.close()
    print(f"ledger initialized: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
