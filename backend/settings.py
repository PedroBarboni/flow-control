from __future__ import annotations

import os
from pathlib import Path


def load_local_environment() -> None:
    path = Path(__file__).resolve().parents[1] / ".env.local"
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())
