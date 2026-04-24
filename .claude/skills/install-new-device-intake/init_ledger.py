#!/usr/bin/env python3
"""Initialize the intake ledger DB if it doesn't exist."""
import sys
from pathlib import Path

# Reuse the ledger module from the sibling skill.
SKILL_DIR = Path(__file__).parent.parent / "new-device-intake"
sys.path.insert(0, str(SKILL_DIR))

from lib import ledger  # noqa: E402

DEFAULT_PATH = "/home/aaron/projects/nanoclaw/data/new-device-intake.db"


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = ledger.open_db(path)
    conn.close()
    print(f"ledger initialized: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
