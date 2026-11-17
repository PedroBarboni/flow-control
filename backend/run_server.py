from __future__ import annotations

import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.append(r"C:\Users\pedro.barboni\Desktop\PGO\.venv\Lib\site-packages")

import uvicorn  # noqa: E402
from backend.local_environment import load_local_environment  # noqa: E402


def server_host() -> str:
    """Retorna o endereço de escuta, acessível na rede privada por padrão."""
    return os.environ.get("FLOW_HOST", "0.0.0.0")


def server_port() -> int:
    """Retorna a porta do Cockpit, com possibilidade de ajuste local."""
    return int(os.environ.get("FLOW_PORT", "5027"))


def run() -> None:
    load_local_environment(PROJECT_ROOT / ".env.local")
    uvicorn.run("backend.main:app", host=server_host(), port=server_port(), reload=False)


if __name__ == "__main__":
    run()
