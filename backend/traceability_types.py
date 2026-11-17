from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


@dataclass(frozen=True)
class ProcessEvent:
    source_key: str
    product_name: str
    process: str
    machine: str
    occurred_at: datetime
    good_pieces: Decimal
    loss_pieces: Decimal
    operator: str
    shift: str


@dataclass(frozen=True)
class RouteDecision:
    resolved: bool
    current_step: str
    next_step: str | None
    consumes_material: bool
    machine_group: str
    reason: str = ""


@dataclass(frozen=True)
class MaterialAllocation:
    lot_id: str
    allocated_kg: Decimal


@dataclass(frozen=True)
class StageAllocation:
    production_lot_id: str
    process: str
    allocated_pieces: Decimal
    origin_type: str


@dataclass(frozen=True)
class ReconciliationResult:
    status: str
    source_key: str
    allocations: tuple[str, ...]
    unmatched_pieces: Decimal
    reason: str = ""
