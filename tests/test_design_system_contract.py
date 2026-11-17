"""Contrato do sistema de design industrial.

Substitui o antigo contrato de `components.css`: os estilos agora vivem em
tokens globais mais um CSS Module por componente, sem camadas de override.
"""

from pathlib import Path
import re
import sys


FRONTEND = Path(__file__).resolve().parents[1] / "frontend"
STYLES = FRONTEND / "src" / "styles"
COMPONENTS = FRONTEND / "src" / "components"


def _module_files() -> list[Path]:
    return sorted(COMPONENTS.rglob("*.module.css"))


def test_global_layers_are_split_by_responsibility() -> None:
    for name in ("tokens.css", "base.css", "accessibility.css"):
        assert (STYLES / name).is_file(), name
    assert not (STYLES / "components.css").exists(), "components.css acumulava gerações de estilos"


def test_every_visual_area_has_its_own_module() -> None:
    expected = {
        "shell/CommandHeader.module.css",
        "catalog/ProductCatalog.module.css",
        "inventory/Inventory.module.css",
        "lots/MaterialLots.module.css",
        "product/ProductWorkspace.module.css",
        "route/ProductionRoute.module.css",
        "central/ControlCenter.module.css",
    }
    present = {path.relative_to(COMPONENTS).as_posix() for path in _module_files()}
    assert expected <= present, expected - present


def test_no_override_layer_and_no_important() -> None:
    """Conflitos são resolvidos na regra, não numa camada final de overrides."""
    for stylesheet in [*_module_files(), *sorted(STYLES.glob("*.css"))]:
        text = stylesheet.read_text(encoding="utf-8")
        if stylesheet.name == "accessibility.css":
            # A única exceção é `prefers-reduced-motion`, que precisa vencer
            # qualquer animação declarada por um componente.
            block = text[text.index("@media (prefers-reduced-motion: reduce)"):]
            assert text.count("!important") == block.count("!important"), stylesheet
            continue
        assert "!important" not in text, stylesheet


def test_typography_never_falls_below_twelve_pixels() -> None:
    for stylesheet in [*_module_files(), *sorted(STYLES.glob("*.css"))]:
        text = stylesheet.read_text(encoding="utf-8")
        for value in re.findall(r"font-size:\s*([0-9.]+)(px|rem)", text):
            size = float(value[0]) * (16 if value[1] == "rem" else 1)
            assert size >= 12, f"{stylesheet}: {value[0]}{value[1]}"


def test_colors_come_from_tokens_not_from_gradients() -> None:
    tokens = (STYLES / "tokens.css").read_text(encoding="utf-8")
    for token in ("--fc-navy-800", "--fc-blue-500", "--fc-teal-600", "--fc-normal", "--fc-attention", "--fc-critical"):
        assert token in tokens, token

    for stylesheet in _module_files():
        text = stylesheet.read_text(encoding="utf-8")
        assert "linear-gradient" not in text, stylesheet
        assert "radial-gradient" not in text, stylesheet
        assert "backdrop-filter" not in text, stylesheet


def test_touch_targets_and_focus_are_declared_globally() -> None:
    accessibility = (STYLES / "accessibility.css").read_text(encoding="utf-8")
    assert "focus-visible" in accessibility
    assert "--fc-touch-target" in accessibility
    assert "prefers-reduced-motion" in accessibility

    base = (STYLES / "base.css").read_text(encoding="utf-8")
    # `clip` contém o estouro horizontal sem quebrar o `position: sticky`
    # da faixa de comando, que `hidden` quebrava.
    assert "overflow-x: clip" in base


def test_route_and_cards_survive_narrow_viewports() -> None:
    route = (COMPONENTS / "route" / "ProductionRoute.module.css").read_text(encoding="utf-8")
    assert "@media (max-width: 620px)" in route
    assert "overflow-wrap: anywhere" in route
    assert "min-width: 0" in route

    catalog = (COMPONENTS / "catalog" / "ProductCatalog.module.css").read_text(encoding="utf-8")
    assert "@media (max-width: 620px)" in catalog
    assert "grid-template-columns: 1fr" in catalog


def run_contract_tests() -> None:
    tests = [
        test_global_layers_are_split_by_responsibility,
        test_every_visual_area_has_its_own_module,
        test_no_override_layer_and_no_important,
        test_typography_never_falls_below_twelve_pixels,
        test_colors_come_from_tokens_not_from_gradients,
        test_touch_targets_and_focus_are_declared_globally,
        test_route_and_cards_survive_narrow_viewports,
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
