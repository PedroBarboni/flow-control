"""Contrato do histórico imutável de movimentações.

A rastreabilidade é uma projeção: some e é recalculada a cada consulta. O
histórico é o oposto — o que o razão decidiu fica gravado, em linha nova,
e nada o altera depois. Estes testes cobrem as duas pontas: o que o motor
produz e o que o banco aceita gravar.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import re
import unittest
from pathlib import Path

from backend.traceability_engine import TraceabilityLedger
from backend.traceability_types import ProcessEvent


ROUTE = ("CORTE", "REBAIXO", "FORJA", "REBARBA", "FURO", "LAMINACAO")
NOW = datetime(2026, 8, 31, 8, 0, tzinfo=timezone.utc)
CONTROL_DATABASE = Path(__file__).resolve().parents[1] / "backend" / "control_database.py"


def pointing(key: str, process: str, machine: str, good: str, loss: str = "0") -> ProcessEvent:
    return ProcessEvent(
        source_key=key,
        product_name="CONECTOR AT",
        process=process,
        machine=machine,
        occurred_at=NOW,
        good_pieces=Decimal(good),
        loss_pieces=Decimal(loss),
        operator="Pedro",
        shift="1",
    )


PLACA_ROUTE = ("CORTE", "FORJA", "REBARBA", "USINAGEM", "PRE_ACABADO")


def placa(key: str, process: str, machine: str, good: str, loss: str = "0") -> ProcessEvent:
    return ProcessEvent(
        source_key=key,
        product_name="PLACA 160",
        process=process,
        machine=machine,
        occurred_at=NOW,
        good_pieces=Decimal(good),
        loss_pieces=Decimal(loss),
        operator="Pedro",
        shift="1",
    )


class MovementRecordingTests(unittest.TestCase):
    def test_cut_records_one_movement_per_rod_lot_consumed(self) -> None:
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
        ledger.add_material_lot("LT-5205-001", Decimal("47.3"), NOW)
        ledger.add_material_lot("LT-5205-002", Decimal("500"), NOW)

        ledger.apply(pointing("A:1", "CORTE", "SERRA 02", "990", "10"), ROUTE)

        cortes = [row for row in ledger.movements if row["movement_type"] == "consumo_vergalhao"]
        self.assertEqual([row["material_lot_id"] for row in cortes], ["LT-5205-001", "LT-5205-002"])
        # O movimento carrega o que foi decidido: peça inteira e kg consumido.
        self.assertEqual(sum(row["good_pieces"] for row in cortes), Decimal("990"))
        self.assertEqual(sum(row["loss_pieces"] for row in cortes), Decimal("10"))
        self.assertEqual(sum(row["consumed_kg"] for row in cortes), Decimal("141.000"))

    def test_identity_is_stable_so_reprocessing_cannot_duplicate(self) -> None:
        """`(source_key, sequence)` identifica o movimento, não a ordem de gravação."""
        def build() -> list[dict[str, object]]:
            ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
            ledger.add_material_lot("LT-5205-001", Decimal("47.3"), NOW)
            ledger.add_material_lot("LT-5205-002", Decimal("500"), NOW)
            ledger.apply(pointing("A:1", "CORTE", "SERRA 02", "990", "10"), ROUTE)
            ledger.apply(pointing("A:2", "REBAIXO", "TORNO 01", "900", "5"), ROUTE)
            return ledger.movements

        primeira, segunda = build(), build()
        chaves = [(row["source_key"], row["sequence"]) for row in primeira]

        self.assertEqual(chaves, [(row["source_key"], row["sequence"]) for row in segunda])
        self.assertEqual(len(chaves), len(set(chaves)), "chave natural repetida")

    def test_stage_movement_names_where_the_piece_came_from_and_goes_to(self) -> None:
        # Placa, não Conector AT: naquela peça o Rebaixo no torno é entrada de
        # material (CORTE_REBAIXO), e o movimento sairia como corte.
        ledger = TraceabilityLedger("placa-160", Decimal("0.323"))
        ledger.add_material_lot("LT-5121-001", Decimal("500"), NOW)
        ledger.apply(placa("A:1", "CORTE", "SERRA 01", "100"), PLACA_ROUTE)
        ledger.apply(placa("A:2", "FORJA", "FORJA 3", "90", "10"), PLACA_ROUTE)

        etapa = next(row for row in ledger.movements if row["movement_type"] == "etapa")
        self.assertEqual(etapa["process"], "FORJA")
        self.assertEqual(etapa["next_process"], "REBARBA")
        self.assertEqual(etapa["material_lot_id"], "LT-5121-001")
        self.assertEqual(etapa["good_pieces"], Decimal("90"))
        self.assertEqual(etapa["loss_pieces"], Decimal("10"))

    def test_unreconciled_pointing_is_recorded_with_its_reason(self) -> None:
        """O que NÃO conciliou também é história: sumir com ele apaga a prova."""
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))

        ledger.apply(pointing("A:9", "FORJA", "FORJA 1", "50"), ROUTE)

        movimento = next(row for row in ledger.movements if row["movement_type"] == "sem_conciliacao")
        self.assertEqual(movimento["process"], "FORJA")
        self.assertEqual(movimento["good_pieces"], Decimal("50"))
        self.assertEqual(movimento["reason"], "Sem saldo do mesmo lote na etapa anterior")

    def test_opening_queue_movement_has_no_rod_lot_instead_of_a_guess(self) -> None:
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
        ledger.add_opening_lot("LT-ABERTURA-1", "FORJA", Decimal("500"), NOW - timedelta(days=1))

        ledger.apply(pointing("A:7", "FORJA", "FORJA 1", "90", "10"), ROUTE)

        etapa = next(row for row in ledger.movements if row["movement_type"] == "etapa")
        self.assertIsNone(etapa["material_lot_id"])
        self.assertEqual(etapa["origin_type"], "abertura")


class LedgerImmutabilityContract(unittest.TestCase):
    """A garantia é do banco, não da boa vontade de quem escreve código."""

    SOURCE = CONTROL_DATABASE.read_text(encoding="utf-8")

    def test_database_refuses_update_and_delete_on_the_ledger(self) -> None:
        self.assertIn("CREATE TRIGGER movement_ledger_no_update", self.SOURCE)
        self.assertIn("BEFORE UPDATE OR DELETE ON flow_control.movement_ledger", self.SOURCE)
        self.assertIn("RAISE EXCEPTION", self.SOURCE)

    def test_application_never_writes_over_a_recorded_movement(self) -> None:
        escritas = re.findall(
            r"(UPDATE|DELETE\s+FROM)\s+flow_control\.movement_ledger",
            self.SOURCE,
            re.IGNORECASE,
        )
        self.assertEqual(escritas, [], "correção no razão é linha nova, nunca sobrescrita")

    def test_write_is_serialised_per_product_and_idempotent(self) -> None:
        # Duas defesas independentes: a trava evita trabalho concorrente
        # inútil, a chave natural garante que nem sem ela haveria duplicata.
        self.assertIn("pg_advisory_xact_lock", self.SOURCE)
        self.assertIn("ON CONFLICT ON CONSTRAINT movement_ledger_identity DO NOTHING", self.SOURCE)
        self.assertIn("CONSTRAINT movement_ledger_identity UNIQUE (product_id, source_key, sequence)", self.SOURCE)


if __name__ == "__main__":
    unittest.main()
