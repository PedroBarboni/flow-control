"""Contratos do frontend oficial.

O React compilado pelo Vite é a única interface entregue pelo FastAPI. Não
existe implementação paralela (`fallback.js`) e nenhuma imagem de peça é
distribuída no build.
"""

import ast
from pathlib import Path
import struct
import sys
import zlib


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = PROJECT_ROOT / "frontend"
DIST_ROOT = FRONTEND_ROOT / "dist"


def _opaque_colors(path: Path) -> set[tuple[int, int, int]]:
    """Cores dos pixels totalmente opacos de um PNG RGBA de 8 bits.

    Lido com a biblioteca padrão de propósito: Pillow não é dependência
    declarada do projeto, e um contrato que só roda com a dependência certa
    instalada não é contrato. Por isso a marca é gravada com as linhas sem
    filtro (tipo 0) — a leitura vira uma fatia, sem reconstruir scanline.
    """
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", path

    header: tuple[int, int, int, int] | None = None
    compressed = bytearray()
    offset = 8
    while offset < len(data):
        (length,) = struct.unpack_from(">I", data, offset)
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        if kind == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", payload[:10])
            header = (width, height, depth, colour)
        elif kind == b"IDAT":
            compressed += payload
        elif kind == b"IEND":
            break
        offset += 12 + length

    assert header is not None, path
    width, height, depth, colour = header
    assert (depth, colour) == (8, 6), f"{path}: esperado RGBA 8 bits, veio {header}"

    raw = zlib.decompress(bytes(compressed))
    stride = width * 4
    colors: set[tuple[int, int, int]] = set()
    for row in range(height):
        start = row * (stride + 1)
        assert raw[start] == 0, f"{path}: linha {row} veio filtrada"
        line = raw[start + 1:start + 1 + stride]
        for pixel in range(0, stride, 4):
            if line[pixel + 3] == 255:
                colors.add((line[pixel], line[pixel + 1], line[pixel + 2]))
    return colors


def test_frontend_entry_uses_vite_typescript_module() -> None:
    index_html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")

    assert 'src="/src/main.tsx"' in index_html
    assert (FRONTEND_ROOT / "src" / "main.tsx").is_file()


def test_frontend_entry_has_no_runtime_cdn_dependencies() -> None:
    index_html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")

    for forbidden_host in ("esm.sh", "unpkg.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"):
        assert forbidden_host not in index_html


def test_no_external_font_or_cdn_reference_in_styles() -> None:
    for stylesheet in FRONTEND_ROOT.joinpath("src").rglob("*.css"):
        text = stylesheet.read_text(encoding="utf-8")
        assert "@import url(" not in text, stylesheet
        for forbidden_host in ("fonts.googleapis.com", "fonts.gstatic.com", "cdn."):
            assert forbidden_host not in text, stylesheet


def test_interface_font_is_packaged_locally() -> None:
    """A tipografia é servida pelo próprio FastAPI; sem rede ela não muda."""
    fonts_css = (FRONTEND_ROOT / "src" / "styles" / "fonts.css").read_text(encoding="utf-8")
    assert 'font-family: "Inter Variable"' in fonts_css
    assert 'font-family: "IBM Plex Mono"' in fonts_css
    assert "/assets/fonts/" in fonts_css
    assert "http://" not in fonts_css and "https://" not in fonts_css

    tokens = (FRONTEND_ROOT / "src" / "styles" / "tokens.css").read_text(encoding="utf-8")
    assert '--fc-font-ui: "Inter Variable"' in tokens
    # Número usa a fonte da interface com dígito tabular — coluna alinhada sem
    # o peso visual da monoespaçada, que fica reservada a código e lote.
    assert '--fc-font-figure: "Inter Variable"' in tokens
    assert '--fc-font-mono: "IBM Plex Mono"' in tokens

    packaged = sorted(path.name for path in (FRONTEND_ROOT / "public" / "assets" / "fonts").glob("*.woff2"))
    assert packaged, "nenhum arquivo de fonte empacotado"
    for name in packaged:
        assert name in fonts_css, name


def test_packaged_white_logo_exists() -> None:
    assets = FRONTEND_ROOT / "public" / "assets"
    assert (assets / "logo-branca.png").is_file()
    # A marca azul continua empacotada para superfície clara (ícone da aba).
    assert (assets / "logo.png").is_file()

    # A "branca" tem que ser branca de fato: o cabeçalho é azul-marinho e o
    # arquivo com esse nome guardou por muito tempo a marca azul, que sumia
    # no fundo escuro. O nome não prova a cor — os pixels provam.
    opacas = _opaque_colors(assets / "logo-branca.png")
    assert opacas == {(255, 255, 255)}, sorted(opacas)[:5]


def test_product_context_shows_calculated_remaining_rod_kg_for_the_active_lot() -> None:
    context = (FRONTEND_ROOT / "src" / "components" / "product" / "ProductContext.tsx").read_text(encoding="utf-8")
    workspace = (FRONTEND_ROOT / "src" / "components" / "product" / "ProductWorkspace.tsx").read_text(encoding="utf-8")
    production_flow = (FRONTEND_ROOT / "src" / "lib" / "productionFlow.ts").read_text(encoding="utf-8")

    assert "Vergalhão restante no lote" in context
    assert "formatKgBR(remainingRodKg)" in context
    assert "calculado" in context
    # O saldo do lote ativo é resolvido uma única vez em productionFlow.ts
    # (não somado aos demais lotes) e reaproveitado pelo workspace, em vez de
    # cada tela refazer sua própria busca em traceability.material.lots.
    assert ".find(" in production_flow
    assert "active_lot_balance_kg" in production_flow
    assert "remainingRodKg={flow.material.active_lot_balance_kg}" in workspace


def test_piece_drawings_are_not_part_of_the_project() -> None:
    """As peças são identificadas por nome e código, não por desenho."""
    assert not (FRONTEND_ROOT / "assets" / "pieces").exists()
    if DIST_ROOT.exists():
        assert not (DIST_ROOT / "assets" / "pieces").exists()
        assert not list(DIST_ROOT.rglob("*-line.png"))


def test_no_parallel_fallback_implementation() -> None:
    """Uma única implementação: o build React servido pelo FastAPI."""
    for name in ("fallback.js", "fallback.css", "fallback-overrides.css", "route-view.mjs"):
        assert not list(FRONTEND_ROOT.rglob(name)), name

    backend_source = (PROJECT_ROOT / "backend" / "main.py").read_text(encoding="utf-8")
    assert "fallback" not in backend_source.lower()


def test_built_index_loads_the_react_bundle() -> None:
    """Só é verificado quando o build existe; o build é gerado antes do deploy."""
    index_file = DIST_ROOT / "index.html"
    if not index_file.is_file():
        return
    index_html = index_file.read_text(encoding="utf-8")
    assert 'type="module"' in index_html
    assert "fallback" not in index_html
    assert '<div id="root">' in index_html


def test_backend_rejects_unbuilt_frontend_instead_of_serving_source() -> None:
    backend_source = (PROJECT_ROOT / "backend" / "main.py").read_text(encoding="utf-8")
    module = ast.parse(backend_source)
    frontend_branch = next(
        (
            node
            for node in module.body
            if isinstance(node, ast.If) and ast.unparse(node.test) == "FRONTEND_DIST.exists()"
        ),
        None,
    )

    assert frontend_branch is not None
    assert frontend_branch.orelse

    fallback_nodes = [node for statement in frontend_branch.orelse for node in ast.walk(statement)]
    assert not any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "mount"
        and node.args
        and isinstance(node.args[0], ast.Constant)
        and node.args[0].value == "/src"
        for node in fallback_nodes
    )

    fallback_handler = next(
        (
            node
            for node in fallback_nodes
            if isinstance(node, ast.FunctionDef)
            and any(
                isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Attribute)
                and decorator.func.attr == "get"
                and decorator.args
                and isinstance(decorator.args[0], ast.Constant)
                and decorator.args[0].value == "/{path:path}"
                for decorator in node.decorator_list
            )
        ),
        None,
    )

    assert fallback_handler is not None

    unavailable_responses = [
        node.exc
        for node in ast.walk(fallback_handler)
        if isinstance(node, ast.Raise)
        and isinstance(node.exc, ast.Call)
        and isinstance(node.exc.func, ast.Name)
        and node.exc.func.id == "HTTPException"
    ]
    assert any(
        any(
            keyword.arg == "status_code"
            and isinstance(keyword.value, ast.Constant)
            and keyword.value.value == 503
            for keyword in response.keywords
        )
        and any(
            keyword.arg == "detail"
            and isinstance(keyword.value, ast.Constant)
            and "build do frontend não foi gerado" in keyword.value.value
            for keyword in response.keywords
        )
        for response in unavailable_responses
    )


def test_catalog_reuses_loaded_data_when_returning_from_product() -> None:
    hook = (FRONTEND_ROOT / "src" / "hooks" / "useApiResource.ts").read_text(encoding="utf-8")
    app = (FRONTEND_ROOT / "src" / "App.tsx").read_text(encoding="utf-8")

    assert "reuseLoaded" in hook
    assert "lastLoadedKey" in hook
    assert "{ enabled: !selectedProduct, reuseLoaded: true }" in app


def test_route_distinguishes_opening_inventory_from_official_lots() -> None:
    """A origem do saldo entre operações é sempre declarada.

    A execução por lote de produção manual saiu do sistema: `in_process_pieces`
    dependia dela e ficava permanentemente em zero, então a etapa não mostra
    mais esse número.
    """
    stage = (FRONTEND_ROOT / "src" / "components" / "route" / "ProductionStage.tsx").read_text(
        encoding="utf-8"
    )

    assert "do inventário de abertura" in stage
    assert "com lote oficial" in stage
    assert "Sem novos apontamentos após o inventário" in stage
    assert "sem origem rastreada" in stage
    assert "Com lote · destino" not in stage
    assert "na fila FIFO" not in stage

    # A pilha parada pertence a QUEM A PRODUZIU e é nomeada pelo seu destino:
    # o que saiu do Corte e espera a Forja aparece no cartão do Corte, escrito
    # "aguardando a etapa Forja". Já foi o contrário, e lia-se a fila da Forja
    # como peça já forjada.
    assert "aguardando a etapa ${waitingFor}" in stage
    assert "Aguardando a etapa ${waitingFor}" in stage
    # A forma interpolada, não a palavra solta: o comentário que explica o
    # bug antigo cita "destino" e não pode reprovar o contrato.
    assert "destino ${" not in stage


def test_inventory_lock_is_visible_and_disables_editing() -> None:
    inventory = (FRONTEND_ROOT / "src" / "components" / "inventory" / "OpeningInventory.tsx").read_text(
        encoding="utf-8"
    )
    row = (FRONTEND_ROOT / "src" / "components" / "inventory" / "InventoryRow.tsx").read_text(
        encoding="utf-8"
    )

    assert "inventory?.locked === true" in inventory
    assert "disabled={locked}" in inventory
    assert "readOnly={locked}" in inventory
    assert "disabled={readOnly}" in row


def run_contract_tests() -> None:
    tests = [
        test_frontend_entry_uses_vite_typescript_module,
        test_frontend_entry_has_no_runtime_cdn_dependencies,
        test_no_external_font_or_cdn_reference_in_styles,
        test_interface_font_is_packaged_locally,
        test_packaged_white_logo_exists,
        test_product_context_shows_calculated_remaining_rod_kg_for_the_active_lot,
        test_piece_drawings_are_not_part_of_the_project,
        test_no_parallel_fallback_implementation,
        test_built_index_loads_the_react_bundle,
        test_backend_rejects_unbuilt_frontend_instead_of_serving_source,
        test_catalog_reuses_loaded_data_when_returning_from_product,
        test_route_distinguishes_opening_inventory_from_official_lots_and_execution,
        test_inventory_lock_is_visible_and_disables_editing,
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
