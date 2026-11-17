"""Contrato da rota agregada usada pela Central de Controle."""

import ast
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]


def _module(name: str) -> ast.Module:
    return ast.parse((ROOT / "backend" / name).read_text(encoding="utf-8"))


def _functions(module: ast.Module) -> dict[str, ast.FunctionDef]:
    return {
        node.name: node
        for node in ast.walk(module)
        if isinstance(node, ast.FunctionDef)
    }


def test_catalog_route_exists_and_is_read_only() -> None:
    source = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
    assert '@app.get("/api/catalog/production")' in source

    function = _functions(_module("main.py"))["catalog_production"]
    body = ast.unparse(function)
    for forbidden in ("INSERT", "UPDATE ", "DELETE", "ALTER", "DROP"):
        assert forbidden not in body.upper(), forbidden


def test_catalog_route_reuses_the_single_production_rule() -> None:
    """A Central e o controle da peça usam a mesma projeção de WIP e perdas."""
    functions = _functions(_module("main.py"))
    assert "_apply_live_production" in functions
    for caller in ("catalog_production", "product_with_live_production"):
        assert "_apply_live_production" in ast.unparse(functions[caller])


def test_catalog_tracks_placa_and_reuses_inventory_scope_for_other_products() -> None:
    body = ast.unparse(_functions(_module("main.py"))["catalog_production"])

    assert "system_start_date().isoformat()" in body
    assert "product_names" in body
    assert "historical_names" in body
    assert "product['id'] != 'placa-160'" in body
    assert "_controlled_product(product['id'], effective_from, effective_to)" in body


def test_bulk_query_keeps_the_same_source_and_filters() -> None:
    function = _functions(_module("database.py"))["_query_totals_by_product_native"]
    body = ast.unparse(function)
    assert "public.apontamentos" in body
    assert "readonly=True" in body
    assert "produto = ANY(%s) OR produto LIKE ANY(%s)" in body


def test_catalog_route_reports_unavailability_instead_of_zero() -> None:
    function = _functions(_module("main.py"))["catalog_production"]
    body = ast.unparse(function)
    assert "'available': False" in body
    assert "indisponíveis" in body


def test_inventory_readiness_counts_distinct_products() -> None:
    function = _functions(_module("main.py"))["opening_inventory"]
    body = ast.unparse(function)
    assert "recorded_ids" in body
    assert "pending_product_ids" in body
    assert "len(rows) == len(PRODUCTS)" not in body


def run_contract_tests() -> None:
    tests = [
        test_catalog_route_exists_and_is_read_only,
        test_catalog_route_reuses_the_single_production_rule,
        test_catalog_tracks_placa_and_reuses_inventory_scope_for_other_products,
        test_bulk_query_keeps_the_same_source_and_filters,
        test_catalog_route_reports_unavailability_instead_of_zero,
        test_inventory_readiness_counts_distinct_products,
    ]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")


if __name__ == "__main__":
    try:
        run_contract_tests()
    except AssertionError as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise SystemExit(1) from error
