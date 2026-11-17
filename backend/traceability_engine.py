from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from backend.traceability_routes import resolve_route
from backend.traceability_types import ProcessEvent, ReconciliationResult


ZERO = Decimal("0")
ONE = Decimal("1")


def _whole(pieces: Decimal) -> Decimal:
    """Peça é indivisível: nenhum saldo de peça sai daqui quebrado.

    Só o vergalhão é contínuo (kg). Assim que o kg vira peça — no corte, ou
    no rateio de um apontamento entre lotes — o resultado tem que ser inteiro:
    não existe 0,375 peça na bancada, e mostrar isso na tela só faz o operador
    duvidar do número.
    """
    return pieces.quantize(ONE, rounding=ROUND_HALF_UP)


@dataclass
class _MaterialLot:
    lot_id: str
    initial_kg: Decimal
    balance_kg: Decimal
    occurred_at: datetime
    transformed_pieces: Decimal = ZERO
    loss_pieces: Decimal = ZERO
    # Ao contrário de transformed_pieces/loss_pieces (só o corte), estes dois
    # acompanham o lote até o fim da rota: soma perda de qualquer etapa que
    # consumir peça vinda dele, e conta a peça só quando chega pronta na
    # última operação.
    finished_pieces: Decimal = ZERO
    route_loss_pieces: Decimal = ZERO


@dataclass
class _QueueBalance:
    lot_id: str
    process: str
    pieces: Decimal
    origin: str
    material_lot_id: str | None
    route_key: str
    occurred_at: datetime


class TraceabilityLedger:
    """Deterministic FIFO projection built from source events.

    The ledger does not modify TOTVS or Apontamentos. Rebuilding it with the
    same inputs produces the same balances and makes source-key ingestion
    idempotent.
    """

    def __init__(
        self,
        product_id: str,
        blank_weight_kg: Decimal,
        *,
        consumption_locked_from: datetime | None = None,
    ) -> None:
        self.product_id = product_id
        self.blank_weight_kg = blank_weight_kg
        self._materials: list[_MaterialLot] = []
        self._queues: list[_QueueBalance] = []
        self._processed_sources: set[str] = set()
        self._production_lot_ids: dict[tuple[str, str], str] = {}
        self._material_sequences: dict[str, int] = {}
        self.consumption_locked_from = consumption_locked_from
        self.unmatched: list[dict[str, object]] = []
        # Cada alocação vira um movimento nomeado, na ordem em que aconteceu.
        # É esta lista que vira histórico gravado — o razão em si continua
        # sendo uma projeção recalculável, mas o que ele decidiu fica.
        self.movements: list[dict[str, object]] = []
        self._movement_sequence: dict[str, int] = {}

    def add_material_lot(self, lot_id: str, quantity_kg: Decimal, occurred_at: datetime) -> None:
        self._materials.append(_MaterialLot(lot_id, quantity_kg, quantity_kg, occurred_at))
        self._materials.sort(key=lambda lot: (lot.occurred_at, lot.lot_id))

    def add_opening_lot(
        self,
        lot_id: str,
        next_process: str,
        pieces: Decimal,
        occurred_at: datetime,
        *,
        status: str = "waiting",
    ) -> None:
        origin = "abertura_em_processo" if status == "in_process" else "abertura"
        self._add_queue(lot_id, next_process, pieces, origin, None, "ABERTURA", occurred_at)

    def apply(
        self,
        event: ProcessEvent,
        route_steps: tuple[str, ...],
        aliases: dict[str, str] | None = None,
    ) -> ReconciliationResult:
        if event.source_key in self._processed_sources:
            return ReconciliationResult("duplicate", event.source_key, (), ZERO)

        route = resolve_route(event, route_steps, aliases)
        if not route.resolved:
            return self._record_unmatched(event, event.good_pieces + event.loss_pieces, route.reason)

        self._processed_sources.add(event.source_key)
        if (
            route.consumes_material
            and self.consumption_locked_from is not None
            and event.occurred_at >= self.consumption_locked_from
        ):
            return ReconciliationResult(
                "suspended", event.source_key, (), ZERO,
                "Consumo de vergalhão temporariamente bloqueado",
            )
        if route.consumes_material:
            return self._apply_cut(event, route.current_step, route.next_step, route.machine_group)
        return self._apply_stage(event, route.current_step, route.next_step)

    def _apply_cut(
        self,
        event: ProcessEvent,
        current_step: str,
        next_step: str | None,
        route_key: str,
    ) -> ReconciliationResult:
        total_pieces = event.good_pieces + event.loss_pieces
        required_kg = total_pieces * self.blank_weight_kg
        remaining_kg = required_kg
        allocations: list[str] = []
        # O rateio entre lotes é calculado sobre o ACUMULADO, não lote a lote:
        # arredondar cada fatia isoladamente perderia ou inventaria peça. Assim
        # cada lote leva peça inteira e a soma fecha exatamente o apontado.
        consumed_kg = ZERO
        good_given = ZERO
        loss_given = ZERO

        for material in self._materials:
            if remaining_kg <= ZERO:
                break
            if material.occurred_at > event.occurred_at:
                continue
            allocated_kg = min(material.balance_kg, remaining_kg)
            if allocated_kg <= ZERO:
                continue
            consumed_kg += allocated_kg
            progress = consumed_kg / required_kg if required_kg > ZERO else ZERO
            good = _whole(event.good_pieces * progress) - good_given
            losses = _whole(event.loss_pieces * progress) - loss_given
            good_given += good
            loss_given += losses
            material.balance_kg -= allocated_kg
            material.transformed_pieces += good
            material.loss_pieces += losses
            material.route_loss_pieces += losses
            remaining_kg -= allocated_kg
            production_lot_id = self._production_lot_id(material.lot_id, route_key)
            allocations.append(production_lot_id)
            self._record_movement(
                event,
                "consumo_vergalhao",
                current_step,
                next_process=next_step,
                material_lot_id=material.lot_id,
                production_lot_id=production_lot_id,
                origin_type="material",
                good_pieces=good,
                loss_pieces=losses,
                consumed_kg=allocated_kg,
            )
            if next_step and good > ZERO:
                self._add_queue(
                    production_lot_id,
                    next_step,
                    good,
                    "material",
                    material.lot_id,
                    route_key,
                    event.occurred_at,
                )

        if remaining_kg > ZERO:
            unmatched_pieces = (
                _whole(remaining_kg / self.blank_weight_kg)
                if self.blank_weight_kg > ZERO
                else total_pieces
            )
            if unmatched_pieces <= ZERO:
                # Sobra menor que meia peça é poeira de arredondamento do kg,
                # não falta de material: não vira divergência.
                return ReconciliationResult("applied", event.source_key, tuple(allocations), ZERO)
            self.unmatched.append({
                "source_key": event.source_key,
                "process": current_step,
                "pieces": unmatched_pieces,
                "reason": "Saldo de vergalhão insuficiente",
            })
            self._record_movement(
                event,
                "sem_conciliacao",
                current_step,
                good_pieces=unmatched_pieces,
                reason="Saldo de vergalhão insuficiente",
            )
            status = "partial" if allocations else "unmatched"
            return ReconciliationResult(status, event.source_key, tuple(allocations), unmatched_pieces, "Saldo de vergalhão insuficiente")

        return ReconciliationResult("applied", event.source_key, tuple(allocations), ZERO)

    def _apply_stage(self, event: ProcessEvent, current_step: str, next_step: str | None) -> ReconciliationResult:
        required = event.good_pieces + event.loss_pieces
        remaining = required
        allocations: list[str] = []
        queues = sorted(
            (queue for queue in self._queues if queue.process == current_step and queue.pieces > ZERO),
            key=lambda queue: (queue.occurred_at, queue.lot_id),
        )

        # Mesmo rateio acumulado do corte: peça inteira por fila, soma exata.
        taken = ZERO
        good_given = ZERO
        loss_given = ZERO

        for queue in queues:
            if remaining <= ZERO:
                break
            allocated = min(queue.pieces, remaining)
            taken += allocated
            progress = taken / required if required > ZERO else ZERO
            good = _whole(event.good_pieces * progress) - good_given
            losses = _whole(event.loss_pieces * progress) - loss_given
            good_given += good
            loss_given += losses
            queue.pieces -= allocated
            remaining -= allocated
            allocations.append(queue.lot_id)
            origin_material = self._material_lot_by_id(queue.material_lot_id)
            self._record_movement(
                event,
                "etapa",
                current_step,
                next_process=next_step,
                material_lot_id=queue.material_lot_id,
                production_lot_id=queue.lot_id,
                origin_type=queue.origin,
                good_pieces=good,
                loss_pieces=losses,
            )
            if origin_material is not None:
                origin_material.route_loss_pieces += losses
            if next_step and good > ZERO:
                self._add_queue(
                    queue.lot_id,
                    next_step,
                    good,
                    queue.origin,
                    queue.material_lot_id,
                    queue.route_key,
                    event.occurred_at,
                )
            elif not next_step and good > ZERO and origin_material is not None:
                # Última etapa da rota: a peça chegou pronta, não vira fila.
                origin_material.finished_pieces += good

        remaining = _whole(remaining)
        if remaining > ZERO:
            self.unmatched.append({
                "source_key": event.source_key,
                "process": current_step,
                "pieces": remaining,
                "reason": "Sem saldo do mesmo lote na etapa anterior",
            })
            self._record_movement(
                event,
                "sem_conciliacao",
                current_step,
                next_process=next_step,
                good_pieces=remaining,
                reason="Sem saldo do mesmo lote na etapa anterior",
            )
            status = "partial" if allocations else "unmatched"
            return ReconciliationResult(status, event.source_key, tuple(allocations), remaining, "Sem saldo do mesmo lote na etapa anterior")

        return ReconciliationResult("applied", event.source_key, tuple(allocations), ZERO)

    def _record_movement(
        self,
        event: ProcessEvent,
        movement_type: str,
        process: str,
        *,
        next_process: str | None = None,
        material_lot_id: str | None = None,
        production_lot_id: str | None = None,
        origin_type: str | None = None,
        good_pieces: Decimal = ZERO,
        loss_pieces: Decimal = ZERO,
        consumed_kg: Decimal = ZERO,
        reason: str | None = None,
    ) -> None:
        """Anota uma alocação já decidida.

        `sequence` é a posição da alocação DENTRO do apontamento: junto com
        `source_key` ele identifica o movimento de forma estável, então
        regravar o mesmo apontamento não duplica nada.
        """
        sequence = self._movement_sequence.get(event.source_key, 0)
        self._movement_sequence[event.source_key] = sequence + 1
        self.movements.append({
            "source_key": event.source_key,
            "sequence": sequence,
            "movement_type": movement_type,
            "process": process,
            "next_process": next_process,
            "material_lot_id": material_lot_id,
            "production_lot_id": production_lot_id,
            "origin_type": origin_type,
            "good_pieces": good_pieces,
            "loss_pieces": loss_pieces,
            "consumed_kg": consumed_kg,
            "machine": event.machine,
            "operator": event.operator,
            "shift": event.shift,
            "occurred_at": event.occurred_at,
            "reason": reason,
        })

    def _record_unmatched(self, event: ProcessEvent, pieces: Decimal, reason: str) -> ReconciliationResult:
        self._processed_sources.add(event.source_key)
        pieces = _whole(pieces)
        self.unmatched.append({
            "source_key": event.source_key,
            "process": event.process,
            "pieces": pieces,
            "reason": reason,
        })
        self._record_movement(
            event,
            "sem_conciliacao",
            event.process,
            good_pieces=pieces,
            reason=reason,
        )
        return ReconciliationResult("unmatched", event.source_key, (), pieces, reason)

    def _production_lot_id(self, material_lot_id: str, route_key: str) -> str:
        key = (material_lot_id, route_key)
        if key not in self._production_lot_ids:
            sequence = self._material_sequences.get(material_lot_id, 0) + 1
            self._material_sequences[material_lot_id] = sequence
            self._production_lot_ids[key] = f"{material_lot_id}-P{sequence:03d}"
        return self._production_lot_ids[key]

    def _add_queue(
        self,
        lot_id: str,
        process: str,
        pieces: Decimal,
        origin: str,
        material_lot_id: str | None,
        route_key: str,
        occurred_at: datetime,
    ) -> None:
        existing = next(
            (queue for queue in self._queues if queue.lot_id == lot_id and queue.process == process),
            None,
        )
        if existing:
            existing.pieces += pieces
            return
        self._queues.append(_QueueBalance(lot_id, process, pieces, origin, material_lot_id, route_key, occurred_at))

    def material_balance(self, lot_id: str) -> Decimal:
        lot = next((row for row in self._materials if row.lot_id == lot_id), None)
        return lot.balance_kg if lot else ZERO

    def _material_lot_by_id(self, material_lot_id: str | None) -> _MaterialLot | None:
        if material_lot_id is None:
            return None
        return next((row for row in self._materials if row.lot_id == material_lot_id), None)

    def lot_queue_balance(self, lot_id: str, process: str) -> Decimal:
        return sum((row.pieces for row in self._queues if row.lot_id == lot_id and row.process == process), ZERO)

    def queue_balance(self, process: str, *, origin: str | None = None) -> Decimal:
        return sum(
            (
                row.pieces for row in self._queues
                if row.process == process and (origin is None or row.origin == origin)
            ),
            ZERO,
        )

    def snapshot(self) -> dict[str, object]:
        return {
            "material_lots": [
                {
                    "lot_id": lot.lot_id,
                    "initial_kg": float(lot.initial_kg),
                    "balance_kg": float(lot.balance_kg),
                    "consumed_kg": float(lot.initial_kg - lot.balance_kg),
                    "transformed_pieces": float(lot.transformed_pieces),
                    "loss_pieces": float(lot.loss_pieces),
                    "finished_pieces": float(lot.finished_pieces),
                    "route_loss_pieces": float(lot.route_loss_pieces),
                }
                for lot in self._materials
            ],
            "queues": [
                {
                    "lot_id": row.lot_id,
                    "process": row.process,
                    "pieces": float(row.pieces),
                    "origin_type": row.origin,
                    "material_lot_id": row.material_lot_id,
                    "route_key": row.route_key,
                }
                for row in self._queues if row.pieces > ZERO
            ],
            "unmatched": [
                {**row, "pieces": float(row["pieces"])} for row in self.unmatched
            ],
        }
