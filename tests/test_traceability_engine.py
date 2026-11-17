from datetime import datetime, timedelta, timezone
from decimal import Decimal
import unittest

from backend.traceability_engine import TraceabilityLedger
from backend.traceability_types import ProcessEvent


ROUTE = ("CORTE", "REBAIXO", "FORJA", "REBARBA", "FURO", "LAMINACAO")
NOW = datetime(2026, 8, 31, 8, 0, tzinfo=timezone.utc)


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


class TraceabilityLedgerTests(unittest.TestCase):
    def test_cut_after_consumption_lock_does_not_reduce_material_balance(self) -> None:
        lock_from = datetime(2026, 9, 2, tzinfo=timezone.utc)
        ledger = TraceabilityLedger("conector-bt-400", Decimal("0.470"), consumption_locked_from=lock_from)
        ledger.add_material_lot("LT-BT400-001", Decimal("1000"), datetime(2026, 9, 1, tzinfo=timezone.utc))

        event = ProcessEvent(
            "AP:LOCKED", "CONECTOR BT 400", "CORTE", "SERRA",
            datetime(2026, 9, 2, 8, tzinfo=timezone.utc), Decimal("100"), Decimal("2"), "Pedro", "1",
        )
        result = ledger.apply(event, ("CORTE", "REBAIXO", "FORJA"))

        self.assertEqual(result.status, "suspended")
        self.assertEqual(ledger.material_balance("LT-BT400-001"), Decimal("1000"))
        self.assertEqual(ledger.queue_balance("REBAIXO"), Decimal("0"))
    def test_saw_cut_consumes_material_and_waits_for_reduction(self) -> None:
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
        ledger.add_material_lot("LT-5205-001", Decimal("500"), NOW)

        result = ledger.apply(pointing("A:1", "CORTE", "SERRA 01", "100", "2"), ROUTE)

        self.assertEqual(result.status, "applied")
        self.assertEqual(ledger.material_balance("LT-5205-001"), Decimal("485.618"))
        self.assertEqual(ledger.queue_balance("REBAIXO", origin="material"), Decimal("100"))
        self.assertEqual(ledger.queue_balance("FORJA", origin="material"), Decimal("0"))

    def test_lathe_cut_consumes_material_and_waits_directly_for_forge(self) -> None:
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
        ledger.add_material_lot("LT-5205-001", Decimal("500"), NOW)

        ledger.apply(pointing("A:2", "CORTE", "TORNO 01", "100", "2"), ROUTE)

        self.assertEqual(ledger.queue_balance("REBAIXO", origin="material"), Decimal("0"))
        self.assertEqual(ledger.queue_balance("FORJA", origin="material"), Decimal("100"))

    def test_pointing_before_transfer_does_not_consume_future_material_lot(self) -> None:
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
        ledger.add_material_lot("LT-5206-001", Decimal("451"), NOW)

        result = ledger.apply(
            ProcessEvent(
                "A:BEFORE", "CONECTOR AT", "REBAIXO", "TORNO",
                NOW - timedelta(days=3), Decimal("1420"), Decimal("0"), "", "",
            ),
            ROUTE,
        )

        self.assertEqual(result.status, "unmatched")
        self.assertEqual(ledger.material_balance("LT-5206-001"), Decimal("451"))

    def test_lathe_reduction_on_transfer_date_consumes_material(self) -> None:
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
        ledger.add_material_lot("LT-5206-001", Decimal("451"), NOW)

        ledger.apply(
            ProcessEvent(
                "A:SAME-DAY", "CONECTOR AT", "REBAIXO", "TORNO",
                NOW, Decimal("1409"), Decimal("0"), "", "",
            ),
            ROUTE,
        )

        self.assertEqual(ledger.material_balance("LT-5206-001"), Decimal("252.331"))
        self.assertEqual(ledger.queue_balance("FORJA", origin="material"), Decimal("1409"))

    def test_old_forge_consumes_opening_lot_without_touching_new_material(self) -> None:
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
        ledger.add_material_lot("LT-5205-001", Decimal("500"), NOW)
        ledger.add_opening_lot("LT-ABERTURA-5205-FORJA-001", "FORJA", Decimal("1200"), NOW - timedelta(days=1))

        ledger.apply(pointing("A:3", "FORJA", "FORJA 1", "100"), ROUTE)

        self.assertEqual(ledger.material_balance("LT-5205-001"), Decimal("500"))
        self.assertEqual(ledger.lot_queue_balance("LT-ABERTURA-5205-FORJA-001", "FORJA"), Decimal("1100"))
        self.assertEqual(ledger.lot_queue_balance("LT-ABERTURA-5205-FORJA-001", "REBARBA"), Decimal("100"))

    def test_forge_cannot_skip_reduction(self) -> None:
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
        ledger.add_material_lot("LT-5205-001", Decimal("500"), NOW)
        ledger.apply(pointing("A:4", "CORTE", "SERRA 01", "100"), ROUTE)

        result = ledger.apply(pointing("A:5", "FORJA", "FORJA 1", "50"), ROUTE)

        self.assertEqual(result.status, "unmatched")
        self.assertEqual(result.unmatched_pieces, Decimal("50"))
        self.assertEqual(ledger.queue_balance("REBAIXO", origin="material"), Decimal("100"))

    def test_same_pointing_is_idempotent(self) -> None:
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
        ledger.add_material_lot("LT-5205-001", Decimal("500"), NOW)
        source = pointing("A:6", "CORTE", "SERRA 01", "100")

        ledger.apply(source, ROUTE)
        duplicate = ledger.apply(source, ROUTE)

        self.assertEqual(duplicate.status, "duplicate")
        self.assertEqual(ledger.queue_balance("REBAIXO", origin="material"), Decimal("100"))

    def test_material_lot_reports_blanks_transformed_and_losses(self) -> None:
        ledger = TraceabilityLedger("placa-160", Decimal("0.323"))
        ledger.add_material_lot("LT-5121-001", Decimal("3386.5"), NOW)

        ledger.apply(
            ProcessEvent(
                "AP:PLACA:1", "PLACA 160", "CORTE", "SERRA 1", NOW,
                Decimal("1115"), Decimal("10"), "Pedro", "1",
            ),
            ("CORTE", "FORJA", "REBARBA", "USINAGEM", "PRE_ACABADO"),
        )

        material = ledger.snapshot()["material_lots"][0]
        self.assertEqual(material["lot_id"], "LT-5121-001")
        self.assertEqual(material["transformed_pieces"], 1115.0)
        self.assertEqual(material["loss_pieces"], 10.0)
        self.assertEqual(material["consumed_kg"], 363.375)

    def test_material_lot_tracks_loss_and_finished_pieces_through_the_whole_route(self) -> None:
        def placa_event(key: str, process: str, machine: str, good: str, loss: str) -> ProcessEvent:
            return ProcessEvent(key, "PLACA 160", process, machine, NOW, Decimal(good), Decimal(loss), "Pedro", "1")

        ledger = TraceabilityLedger("placa-160", Decimal("0.323"))
        ledger.add_material_lot("LT-5121-001", Decimal("3386.5"), NOW)
        route = ("CORTE", "FORJA", "REBARBA", "USINAGEM", "PRE_ACABADO")

        ledger.apply(placa_event("A:1", "CORTE", "SERRA 1", "1000", "10"), route)
        ledger.apply(placa_event("A:2", "FORJA", "FORJA 1", "950", "50"), route)
        ledger.apply(placa_event("A:3", "REBARBA", "PH 1", "900", "50"), route)
        ledger.apply(placa_event("A:4", "USINAGEM", "CNC", "850", "50"), route)
        ledger.apply(placa_event("A:5", "PRE_ACABADO", "SOLDA", "800", "50"), route)

        material = ledger.snapshot()["material_lots"][0]
        # transformed_pieces/loss_pieces continuam só o corte (sem mudar de sentido).
        self.assertEqual(material["transformed_pieces"], 1000.0)
        self.assertEqual(material["loss_pieces"], 10.0)
        # route_loss_pieces soma a perda de TODAS as etapas: 10+50+50+50+50.
        self.assertEqual(material["route_loss_pieces"], 210.0)
        # finished_pieces só conta o que chegou pronto na última etapa (Pré-acabado).
        self.assertEqual(material["finished_pieces"], 800.0)
        self.assertEqual(ledger.queue_balance("PRE_ACABADO", origin="material"), Decimal("0"))

    def test_opening_queue_losses_are_not_attributed_to_any_material_lot(self) -> None:
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
        ledger.add_opening_lot("LT-ABERTURA-5205-FORJA-001", "FORJA", Decimal("500"), NOW - timedelta(days=1))

        ledger.apply(pointing("A:7", "FORJA", "FORJA 1", "90", "10"), ROUTE)

        # Sem lote de vergalhão de origem: nada quebra, nada fica presumido.
        self.assertEqual(ledger.snapshot()["material_lots"], [])


class WholePieceTests(unittest.TestCase):
    """Peça é indivisível: nenhum saldo de peça pode sair quebrado.

    Só o vergalhão é contínuo. Quando um apontamento é rateado entre dois
    lotes, a divisão é feita em peça inteira — e a soma das partes tem que
    fechar exatamente o que foi apontado, sem perder nem inventar peça.
    """

    def test_cut_split_between_two_lots_gives_whole_pieces_that_add_up(self) -> None:
        # 0,141 kg × 1.000 peças = 141 kg, mas o primeiro lote só tem 47,3 kg:
        # o rateio cai em 335,46... peças, que não existem na bancada.
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
        ledger.add_material_lot("LT-5205-001", Decimal("47.3"), NOW)
        ledger.add_material_lot("LT-5205-002", Decimal("500"), NOW)

        ledger.apply(pointing("A:1", "CORTE", "SERRA 02", "990", "10"), ROUTE)

        lots = {row["lot_id"]: row for row in ledger.snapshot()["material_lots"]}
        for lot in lots.values():
            self.assertEqual(lot["transformed_pieces"], int(lot["transformed_pieces"]), lot)
            self.assertEqual(lot["loss_pieces"], int(lot["loss_pieces"]), lot)

        self.assertEqual(
            lots["LT-5205-001"]["transformed_pieces"] + lots["LT-5205-002"]["transformed_pieces"],
            990.0,
        )
        self.assertEqual(
            lots["LT-5205-001"]["loss_pieces"] + lots["LT-5205-002"]["loss_pieces"],
            10.0,
        )
        self.assertEqual(ledger.queue_balance("REBAIXO"), Decimal("990"))

    def test_stage_split_between_two_queues_gives_whole_pieces_that_add_up(self) -> None:
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
        ledger.add_opening_lot("LT-ABERTURA-A", "FORJA", Decimal("7"), NOW - timedelta(days=1))
        ledger.add_opening_lot("LT-ABERTURA-B", "FORJA", Decimal("500"), NOW - timedelta(days=1))

        ledger.apply(pointing("A:2", "FORJA", "FORJA 1", "97", "3"), ROUTE)

        rebarba = [row for row in ledger.snapshot()["queues"] if row["process"] == "REBARBA"]
        for row in rebarba:
            self.assertEqual(row["pieces"], int(row["pieces"]), row)
        self.assertEqual(sum(row["pieces"] for row in rebarba), 97.0)

    def test_rounding_dust_in_the_rod_balance_is_not_reported_as_shortage(self) -> None:
        """Sobra menor que meia peça é resto de kg, não falta de material."""
        ledger = TraceabilityLedger("conector-at", Decimal("0.141"))
        ledger.add_material_lot("LT-5205-001", Decimal("14.09"), NOW)

        result = ledger.apply(pointing("A:3", "CORTE", "SERRA 02", "100"), ROUTE)

        self.assertEqual(result.status, "applied")
        self.assertEqual(ledger.snapshot()["unmatched"], [])


if __name__ == "__main__":
    unittest.main()
