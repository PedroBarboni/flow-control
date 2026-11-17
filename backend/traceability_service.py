from __future__ import annotations

from datetime import datetime, time, timezone
from decimal import Decimal
import re
from typing import Any, Iterable
import unicodedata

from backend.traceability_engine import TraceabilityLedger
from backend.traceability_routes import build_route_aliases
from backend.traceability_types import ProcessEvent


def _timestamp(value: str | None) -> datetime:
    if not value:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    text = str(value)
    if "/" in text:
        return datetime.strptime(text, "%d/%m/%Y").replace(tzinfo=timezone.utc)
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _process(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    ascii_text = "".join(character for character in text if not unicodedata.combining(character))
    return re.sub(r"[^A-Z0-9]+", "_", ascii_text.upper()).strip("_")


def _route_position(process: str, route_steps: tuple[str, ...]) -> int:
    """Posição da operação na rota. Operação fora da rota é consumida por último."""
    step = _process(process)
    return route_steps.index(step) if step in route_steps else len(route_steps)


def _next_route_step(process: str, route_steps: tuple[str, ...]) -> str | None:
    """Operação que consome a saída de `process`.

    Devolve `None` quando `process` é a última da rota — nesse caso a posição do
    inventário é peça acabada e não entra em nenhuma fila — ou quando a operação
    não pertence à rota cadastrada.
    """
    step = _process(process)
    if step not in route_steps:
        return None
    index = route_steps.index(step)
    return route_steps[index + 1] if index + 1 < len(route_steps) else None


def _consumption_order(route_steps: tuple[str, ...]):
    """Ordem de consumo dos apontamentos.

    O horário real manda sempre que existir. Quando os apontamentos chegam com
    o mesmo instante — o caso da tabela `public.apontamentos`, que guarda só a
    data e faz o dia inteiro cair na meia-noite —, o desempate passa a ser a
    sequência da rota, e não o id do registro.

    A ordem de digitação não representa a sequência física: fechar o dia pelo id
    faz uma operação consumir a fila antes de a operação anterior tê-la
    abastecido, inventando divergência que não existe no chão de fábrica.

    O contrário não é verdade: com data e hora reais, a cronologia é preservada
    e uma inversão física continua sendo apontada como divergência.
    """

    def chave(event):
        return (event.occurred_at, _route_position(event.process, route_steps), event.source_key)

    return chave


def build_traceability_snapshot(
    product: dict[str, Any],
    totvs: dict[str, Any],
    opening_rows: Iterable[dict[str, Any]],
    events: Iterable[ProcessEvent],
    *,
    consumption_locked_from: datetime | None = None,
) -> dict[str, Any]:
    weight = Decimal(str(product.get("blank_weight_kg") or 0))
    ledger = TraceabilityLedger(
        product["id"], weight, consumption_locked_from=consumption_locked_from
    )

    for lot in sorted(totvs.get("lots", []), key=lambda row: (_timestamp(row.get("date")), row.get("source_record") or 0)):
        quantity = Decimal(str(lot.get("initial_kg") or 0))
        if quantity > 0:
            ledger.add_material_lot(lot["id"], quantity, _timestamp(lot.get("date")))

    route_steps = tuple(_process(stage["process"]) for stage in product.get("tracking_stages", []))

    opening_sequences: dict[str, int] = {}
    for row in opening_rows:
        if str(row.get("position_status") or "waiting") == "completed":
            continue
        process = _process(str(row.get("process") or ""))
        pieces = Decimal(str(row.get("piece_quantity") or 0))
        if not process or pieces <= 0:
            continue
        # A posição do inventário nomeia a operação que a peça JÁ sofreu: a pilha
        # do Corte são blanks cortados aguardando o Rebaixo, e a pilha do Rebaixo
        # (inclusive a que saiu do torno) aguarda a Forja. Por isso ela entra na
        # fila da operação SEGUINTE — é essa que vai consumi-la.
        waiting_for = _next_route_step(process, route_steps)
        if waiting_for is None:
            # Última operação da rota: já é peça acabada, não fila de processo.
            continue
        opening_sequences[process] = opening_sequences.get(process, 0) + 1
        lot_id = f'LT-ABERTURA-{product.get("code") or product["id"]}-{process}-{opening_sequences[process]:03d}'
        ledger.add_opening_lot(
            lot_id,
            waiting_for,
            pieces,
            _timestamp(row.get("reference_date")),
            status=str(row.get("position_status") or "waiting"),
        )

    aliases = build_route_aliases(product)
    for event in sorted(events, key=_consumption_order(route_steps)):
        ledger.apply(event, route_steps, aliases)

    # Quanto cada etapa consumiu por dia, separado pela ORIGEM da peça. Sem
    # isso o diagnóstico só sabe dizer "a fila cobriu 563" — e não que essas
    # 563 vieram do inventário de abertura, não da etapa anterior. A fila é
    # abastecida pelos dois, e quem lê precisa enxergar os dois.
    consumption: dict[str, dict[str, float]] = {}
    for movement in ledger.movements:
        if movement["movement_type"] not in ("etapa", "consumo_vergalhao"):
            continue
        occurred_at = movement["occurred_at"]
        key = f'{movement["process"]}|{occurred_at.date().isoformat()}'
        origin = (
            "abertura"
            if str(movement.get("origin_type") or "").startswith("abertura")
            else "lote"
        )
        bucket = consumption.setdefault(key, {"abertura": 0.0, "lote": 0.0})
        bucket[origin] += float(movement["good_pieces"])

    raw = ledger.snapshot()
    material_lots = raw["material_lots"]
    initial_kg = sum(row["initial_kg"] for row in material_lots)
    remaining_kg = sum(row["balance_kg"] for row in material_lots)
    active_lot = next((row for row in material_lots if row["balance_kg"] > 0), None)

    stage_names = list(dict.fromkeys([*route_steps, *(row["process"] for row in raw["queues"])]))
    stages: list[dict[str, Any]] = []
    for process in stage_names:
        rows = [row for row in raw["queues"] if row["process"] == process]
        identified = sum(row["pieces"] for row in rows if row["origin_type"] == "material")
        opening = sum(row["pieces"] for row in rows if str(row["origin_type"]).startswith("abertura"))
        unmatched = sum(
            row["pieces"] for row in raw["unmatched"]
            if _process(str(row["process"])) == process
        )
        stages.append({
            "process": process,
            "available_pieces": identified + opening,
            "identified_pieces": identified,
            "opening_pieces": opening,
            "unmatched_pieces": unmatched,
            "lots": rows,
        })

    return {
        "product_id": product["id"],
        "material": {
            "active_lot_id": active_lot["lot_id"] if active_lot else None,
            "initial_kg": round(initial_kg, 6),
            "consumed_kg": round(initial_kg - remaining_kg, 6),
            "remaining_kg": round(remaining_kg, 6),
            "method": "calculado",
            "lots": material_lots,
        },
        "stages": stages,
        # Movimentações na ordem em que o razão as decidiu. Saem daqui em
        # Decimal/datetime, para gravação — quem responde HTTP remove a chave.
        "movements": ledger.movements,
        "consumption": consumption,
        "unmatched_pieces": sum(row["pieces"] for row in raw["unmatched"]),
        "unmatched": raw["unmatched"],
        "source_status": {"totvs": "online", "apontamentos": "online"},
        "controls": {
            "material_consumption_locked": consumption_locked_from is not None,
            "material_consumption_locked_from": (
                consumption_locked_from.isoformat() if consumption_locked_from else None
            ),
        },
    }
