from __future__ import annotations

import re
import unicodedata

from backend.traceability_types import ProcessEvent, RouteDecision


def _normalize(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    ascii_text = "".join(character for character in text if not unicodedata.combining(character))
    return re.sub(r"[^A-Z0-9]+", " ", ascii_text.upper()).strip()


def normalize_machine(value: str) -> str:
    return _normalize(value)


def _step(value: str) -> str:
    return _normalize(value).replace(" ", "_")


def build_route_aliases(product: dict) -> dict[str, str]:
    """Nomes que o chão de fábrica aponta e que a rota conhece por outro nome.

    O catálogo já carrega os dois: `stages[].name` é como a operação é chamada
    na fábrica (ex.: "Solda") e `tracking_stages[].process`, refletido em
    `stages[].tracking_name`, é o nome da rota (ex.: "Pré-acabado"). Sem essa
    ponte, um apontamento de SOLDA não pertence a rota nenhuma e a peça inteira
    fica sem conciliação.
    """
    aliases: dict[str, str] = {}
    for stage in product.get("stages") or []:
        name = _step(str(stage.get("name") or ""))
        tracking = _step(str(stage.get("tracking_name") or ""))
        if name and tracking and name != tracking:
            aliases[name] = tracking
    return aliases


def resolve_route(
    event: ProcessEvent,
    route_steps: tuple[str, ...],
    aliases: dict[str, str] | None = None,
) -> RouteDecision:
    machine = normalize_machine(event.machine)
    process = _step(event.process)
    if aliases:
        process = aliases.get(process, process)

    product = _normalize(event.product_name)
    if product.startswith("CONECTOR AT") and process in {"CORTE", "BLANK", "REBAIXO"}:
        if machine.startswith("TORNO"):
            return RouteDecision(True, "CORTE_REBAIXO", "FORJA", True, "TORNO")
        if process == "REBAIXO":
            return RouteDecision(True, "REBAIXO", "FORJA", False, machine or "NAO_INFORMADA")
        if machine.startswith("SERRA"):
            return RouteDecision(True, "CORTE", "REBAIXO", True, "SERRA")
        return RouteDecision(
            False,
            process,
            None,
            False,
            "DESCONHECIDA",
            "Máquina ausente ou desconhecida para a rota da Conector AT",
        )

    steps = tuple(_step(step) for step in route_steps)
    if process not in steps:
        return RouteDecision(
            False,
            process,
            None,
            False,
            machine or "DESCONHECIDA",
            "Processo não pertence à rota cadastrada",
        )

    index = steps.index(process)
    next_step = steps[index + 1] if index + 1 < len(steps) else None
    return RouteDecision(
        True,
        process,
        next_step,
        index == 0,
        machine or "NAO_INFORMADA",
    )
