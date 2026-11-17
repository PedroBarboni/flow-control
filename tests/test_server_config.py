"""Contract tests for the local Flow Control server.

The file is intentionally runnable without pytest.  The direct runner extracts
the small configuration functions with the standard library when optional
backend dependencies are not installed in the active Python runtime.
"""

from __future__ import annotations

import ast
import os
import sys
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def _ast_symbols(path: Path, names: set[str], extra: dict | None = None) -> dict:
    """Load selected pure symbols without importing optional application deps."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    selected: list[ast.AST] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names:
            node.decorator_list = []
            selected.append(node)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if any(isinstance(target, ast.Name) and target.id in names for target in targets):
                selected.append(node)
    namespace = {"os": os}
    if extra:
        namespace.update(extra)
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(path), "exec"), namespace)
    return namespace


def _run_server_symbols() -> dict:
    try:
        from backend.run_server import server_host, server_port

        return {"server_host": server_host, "server_port": server_port}
    except Exception:
        # The contract remains testable when a local optional binary/dependency
        # prevents importing Uvicorn in the active interpreter.
        return _ast_symbols(ROOT / "backend" / "run_server.py", {"server_host", "server_port"})


def _cors_symbols() -> dict:
    return _ast_symbols(ROOT / "backend" / "main.py", {"DEFAULT_CORS_ORIGINS", "cors_origins"})


def test_server_defaults_to_private_lan_binding() -> None:
    symbols = _run_server_symbols()
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("FLOW_HOST", None)
        os.environ.pop("FLOW_PORT", None)
        assert symbols["server_host"]() == "0.0.0.0"
        assert symbols["server_port"]() == 5027


def test_server_allows_explicit_environment_override() -> None:
    symbols = _run_server_symbols()
    with patch.dict(os.environ, {"FLOW_HOST": "127.0.0.1", "FLOW_PORT": "6027"}, clear=False):
        assert symbols["server_host"]() == "127.0.0.1"
        assert symbols["server_port"]() == 6027


def test_cors_keeps_fixed_origins_and_accepts_configured_origin() -> None:
    symbols = _cors_symbols()
    with patch.dict(os.environ, {"FLOW_CORS_ORIGINS": "http://intranet.local:5173"}, clear=False):
        origins = symbols["cors_origins"]()
    assert origins[:3] == [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://192.168.0.18:5173",
    ]
    assert "http://intranet.local:5173" in origins


def test_cors_excludes_wildcard_even_when_configured() -> None:
    symbols = _cors_symbols()
    with patch.dict(os.environ, {"FLOW_CORS_ORIGINS": "*, http://192.168.0.19:5173, *"}, clear=False):
        origins = symbols["cors_origins"]()
    assert "*" not in origins
    assert "http://192.168.0.19:5173" in origins


def test_missing_frontend_build_returns_explicit_503() -> None:
    class ExpectedHTTPException(Exception):
        def __init__(self, *, status_code: int, detail: str):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    symbols = _ast_symbols(
        ROOT / "backend" / "main.py",
        {"frontend_build_missing"},
        {"HTTPException": ExpectedHTTPException},
    )
    try:
        symbols["frontend_build_missing"]("")
    except ExpectedHTTPException as error:
        assert error.status_code == 503
        assert "build do frontend" in error.detail
    else:  # pragma: no cover - protects the contract if the fallback is removed
        raise AssertionError("fallback sem build deveria retornar HTTP 503")


def test_launcher_discovers_runtime_and_waits_for_api() -> None:
    launcher = (ROOT / "Iniciar Flow Control.cmd").read_text(encoding="utf-8")
    assert "C:\\Users\\" not in launcher
    assert "FLOW_PYTHON" in launcher
    assert ".venv\\Scripts\\python.exe" in launcher
    assert "where python" in launcher
    assert "where py" in launcher
    assert "%USERPROFILE%\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe" in launcher
    assert "import fastapi, uvicorn, pydantic_core" in launcher
    assert launcher.index("FLOW_PYTHON") < launcher.index(".venv\\Scripts\\python.exe")
    assert launcher.index(".venv\\Scripts\\python.exe") < launcher.index("where python")
    assert launcher.index("where python >") < launcher.index("where py >")
    assert "api/health" in launcher
    assert "api/products" in launcher
    assert "-NoProxy" in launcher


def test_vite_proxy_uses_server_port() -> None:
    config = (ROOT / "frontend" / "vite.config.ts").read_text(encoding="utf-8")
    assert '"http://127.0.0.1:5027"' in config


def _direct_runner() -> int:
    tests = [
        test_server_defaults_to_private_lan_binding,
        test_server_allows_explicit_environment_override,
        test_cors_keeps_fixed_origins_and_accepts_configured_origin,
        test_cors_excludes_wildcard_even_when_configured,
        test_missing_frontend_build_returns_explicit_503,
        test_launcher_discovers_runtime_and_waits_for_api,
        test_vite_proxy_uses_server_port,
    ]
    failures: list[str] = []
    for test in tests:
        try:
            test()
        except Exception as error:  # pragma: no cover - direct runner reporting
            failures.append(f"{test.__name__}: {error}")
    if failures:
        print("FAIL: server configuration contract")
        print("\n".join(failures))
        return 1
    print(f"PASS: server configuration contract ({len(tests)} testes)")
    return 0


if __name__ == "__main__":
    sys.exit(_direct_runner())
