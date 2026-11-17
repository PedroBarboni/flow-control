from __future__ import annotations

import os
from datetime import date
from typing import Any


def _configured_date(name: str, default: str) -> date:
    return date.fromisoformat(os.environ.get(name, default))


def system_start_date() -> date:
    return _configured_date("FLOW_LOT_CONTROL_START", "2026-08-28")


def production_reset_date() -> date:
    return _configured_date("FLOW_PRODUCTION_RESET_DATE", "2026-09-01")


def inventory_date() -> date:
    return _configured_date("FLOW_INVENTORY_DATE", "2026-09-01")


def control_schedule(today: date | None = None) -> dict[str, Any]:
    current = today or date.today()
    starts_at = system_start_date()
    reset_at = production_reset_date()
    inventory_at = inventory_date()
    operational = current >= starts_at
    return {
        "operational": operational,
        "mode": "operational" if operational else "scheduled",
        "starts_at": starts_at.isoformat(),
        "starts_at_label": starts_at.strftime("%d/%m/%Y"),
        "reset_at": reset_at.isoformat(),
        "reset_at_label": reset_at.strftime("%d/%m/%Y"),
        "inventory_at": inventory_at.isoformat(),
        "inventory_at_label": inventory_at.strftime("%d/%m/%Y"),
        "inventory_required": current >= inventory_at,
        "inventory_fields": ["piece", "process", "piece_quantity", "rod_kg_in_process"],
    }


def current_cycle_range(today: date | None = None) -> tuple[date, date]:
    current = today or date.today()
    start = production_reset_date() if current >= production_reset_date() else system_start_date()
    return start, current


def traceability_range(
    date_from: str | None,
    date_to: str | None,
    today: date | None = None,
) -> tuple[date, date]:
    """Intervalo usado para reconstruir a origem dos lotes.

    O filtro de produção pode reiniciar em uma nova competência, mas um lote de
    material não perde os apontamentos que o formaram antes dessa virada. A
    rastreabilidade é, portanto, reconstruída desde o início oficial do
    controle, respeitando sempre o fim solicitado pela tela.
    """
    current = today or date.today()
    requested_start = date.fromisoformat(date_from) if date_from else current_cycle_range(current)[0]
    requested_end = date.fromisoformat(date_to) if date_to else current
    history_start = system_start_date()
    if requested_end < history_start:
        return requested_start, requested_end
    return history_start, requested_end
