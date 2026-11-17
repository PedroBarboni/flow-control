import unittest
from datetime import datetime, timezone
from decimal import Decimal

from backend.main import (
    OpeningInventoryInput,
    _completed_pieces_from_last_process,
    _events_after_inventory,
    _inventory_process_valid,
    _opening_inventory_snapshot,
    _conector_at_torno_snapshot,
    _process_events_for_control,
    _product_control_start,
    _traceability_history_start,
)


class InventoryLockTests(unittest.TestCase):
    def test_inventory_write_is_refused_while_temporary_lock_is_active(self) -> None:
        from backend.main import OpeningInventoryInput, update_opening_inventory
        from fastapi import HTTPException

        payload = OpeningInventoryInput(
            process="Corte", position_status="waiting", piece_quantity=10,
            rod_kg_in_process=None, operator_name="Teste",
        )

        with self.assertRaises(HTTPException) as raised:
            update_opening_inventory("placa-160", payload)

        self.assertEqual(raised.exception.status_code, 423)
        self.assertIn("temporariamente bloqueado", raised.exception.detail)
from backend.traceability_types import ProcessEvent


class ProductControlScopeTest(unittest.TestCase):
    def test_placa_always_starts_on_august_28(self) -> None:
        self.assertEqual(_product_control_start("placa-160", "2026-09-01"), "2026-08-28")

    def test_conector_at_traceability_starts_on_august_28(self) -> None:
        self.assertEqual(_product_control_start("conector-at", "2026-09-01"), "2026-08-28")

    def test_other_products_ignore_events_before_inventory(self) -> None:
        self.assertEqual(_traceability_history_start("conector-bt-400", "2026-09-01"), "2026-09-01")
        self.assertEqual(_traceability_history_start("placa-160", "2026-09-01"), "2026-08-28")

    def test_other_products_keep_only_opening_inventory_positions(self) -> None:
        product = {
            "id": "conector-at",
            "name": "Conector AT",
            "stages": [
                {"name": "Blank", "tracking_name": "Corte"},
                {"name": "Forja", "tracking_name": "Forja"},
            ],
        }
        rows = [
            {"product_id": "conector-at", "process": "Corte", "position_status": "waiting", "piece_quantity": 120},
            {"product_id": "conector-at", "process": "Forja", "position_status": "in_process", "piece_quantity": 80},
            {"product_id": "other", "process": "Corte", "position_status": "waiting", "piece_quantity": 999},
        ]

        snapshot = _opening_inventory_snapshot(product, rows, "2026-09-01")

        self.assertEqual(snapshot["visible_wip"], 200)
        self.assertEqual(snapshot["wip"], 200)
        self.assertEqual(snapshot["unidentified_wip"], 0)
        self.assertEqual(snapshot["stages"][0]["awaiting_pieces"], 120)
        self.assertEqual(snapshot["stages"][1]["in_process_pieces"], 80)

    def test_other_product_without_inventory_stays_zero(self) -> None:
        product = {"id": "conector-at", "name": "Conector AT", "stages": [{"name": "Blank"}]}

        snapshot = _opening_inventory_snapshot(product, [], "2026-09-01")

        self.assertEqual(snapshot["visible_wip"], 0)
        self.assertEqual(snapshot["stages"][0]["awaiting_pieces_total"], 0)

    def test_completed_opening_position_moves_from_wip_to_produced(self) -> None:
        product = {
            "id": "placa-400",
            "name": "Placa 400",
            "stages": [
                {"name": "Corte", "tracking_name": "Corte"},
                {"name": "Solda", "tracking_name": "Pré-acabado"},
            ],
        }
        rows = [
            {"product_id": "placa-400", "process": "Corte", "position_status": "waiting", "piece_quantity": 338},
            {"product_id": "placa-400", "process": "Pré-acabado", "position_status": "completed", "piece_quantity": 2371},
        ]

        snapshot = _opening_inventory_snapshot(product, rows, "2026-09-01")

        self.assertEqual(snapshot["visible_wip"], 338)
        self.assertEqual(snapshot["actual_pieces"], 2371)
        self.assertEqual(snapshot["stages"][-1]["reported"], 2371)
        self.assertEqual(snapshot["stages"][-1]["awaiting_pieces_total"], 0)

    def test_conector_at_shows_only_lathe_reduction_on_or_after_transfer(self) -> None:
        product = {
            "id": "conector-at",
            "name": "Conector AT",
            "stages": [{"name": "Rebaixo", "tracking_name": "Rebaixo"}],
        }
        events = [
            ProcessEvent("A:OLD", "CONECTOR AT", "REBAIXO", "TORNO", datetime(2026, 8, 28, tzinfo=timezone.utc), Decimal("1420"), Decimal("0"), "", ""),
            ProcessEvent("A:VALID", "CONECTOR AT", "REBAIXO", "TORNO", datetime(2026, 8, 31, tzinfo=timezone.utc), Decimal("1409"), Decimal("0"), "", ""),
            ProcessEvent("A:CNC", "CONECTOR AT", "REBAIXO", "CNC 3", datetime(2026, 8, 31, tzinfo=timezone.utc), Decimal("999"), Decimal("0"), "", ""),
        ]

        snapshot = _conector_at_torno_snapshot(
            product,
            [],
            events,
            [{"date": "31/08/2026"}],
            "2026-09-01",
        )

        self.assertEqual(snapshot["stages"][0]["reported"], 1409)
        self.assertEqual(snapshot["stages"][0]["loss"], 0)
        self.assertEqual(snapshot["stages"][0]["last_date"], "2026-08-31")
        self.assertEqual(snapshot["stages"][0]["machine"], "TORNO")
        self.assertEqual(snapshot["stages"][0]["status"], "normal")
        self.assertEqual(snapshot["visible_wip"], 1409)
        self.assertEqual(snapshot["wip"], 1409)

    def test_conector_at_inventory_remains_the_official_wip_after_lathe_reconciliation(self) -> None:
        product = {
            "id": "conector-at",
            "name": "Conector AT",
            "stages": [
                {"name": "Rebaixo", "tracking_name": "Rebaixo"},
                {"name": "Forja", "tracking_name": "Forja"},
                {"name": "Laminacao", "tracking_name": "Laminacao"},
            ],
        }
        rows = [
            {"product_id": "conector-at", "process": "Forja", "position_status": "waiting", "piece_quantity": 2825},
            {"product_id": "conector-at", "process": "Laminacao", "position_status": "completed", "piece_quantity": 21113},
        ]
        event = ProcessEvent("A:VALID", "CONECTOR AT", "REBAIXO", "TORNO", datetime(2026, 8, 31, tzinfo=timezone.utc), Decimal("1409"), Decimal("0"), "", "")

        snapshot = _conector_at_torno_snapshot(product, rows, [event], [{"date": "31/08/2026"}], "2026-09-01")

        self.assertEqual(snapshot["visible_wip"], 2825)
        self.assertEqual(snapshot["actual_pieces"], 21113)

    def test_only_products_with_confirmed_history_read_apontamentos(self) -> None:
        calls = []

        def query(database_name: str, date_from: str, date_to: str) -> list[dict]:
            calls.append((database_name, date_from, date_to))
            return [{"quantity": 7410}]

        placa_events = _process_events_for_control(
            "placa-160", "PLACA 160", "2026-08-28", "2026-09-01", query
        )
        other_events = _process_events_for_control(
            "conector-at", "CONECTOR AT", "2026-08-28", "2026-09-01", query
        )
        unrelated_events = _process_events_for_control(
            "suporte-160", "SUPORTE 160", "2026-08-28", "2026-09-01", query
        )

        self.assertEqual(placa_events, [{"quantity": 7410}])
        self.assertEqual(other_events, [{"quantity": 7410}])
        self.assertEqual(unrelated_events, [{"quantity": 7410}])
        self.assertEqual(calls, [
            ("PLACA 160", "2026-08-28", "2026-09-01"),
            ("CONECTOR AT", "2026-08-28", "2026-09-01"),
            ("SUPORTE 160", "2026-08-28", "2026-09-01"),
        ])

    def test_inventory_preserves_unavailable_rod_kg(self) -> None:
        payload = OpeningInventoryInput(
            process="Corte",
            position_status="waiting",
            piece_quantity=0,
            rod_kg_in_process=None,
            operator_name="Carga inicial informada pelo usuário",
        )

        self.assertIsNone(payload.rod_kg_in_process)

    def test_other_products_apply_only_events_saved_after_inventory(self) -> None:
        rows = [{"updated_at": "2026-09-01T12:00:00+00:00"}]
        events = [
            ProcessEvent("A:BEFORE", "CONECTOR BT 400", "CORTE", "SERRA", datetime(2026, 9, 1, 11, tzinfo=timezone.utc), Decimal("10"), Decimal("0"), "", ""),
            ProcessEvent("A:AFTER", "CONECTOR BT 400", "CORTE", "SERRA", datetime(2026, 9, 1, 13, tzinfo=timezone.utc), Decimal("20"), Decimal("0"), "", ""),
        ]

        filtered = _events_after_inventory("conector-bt-400", rows, events)

        self.assertEqual([event.source_key for event in filtered], ["A:AFTER"])
        self.assertEqual(_events_after_inventory("placa-160", rows, events), events)

    def test_completed_quantity_comes_only_from_last_process(self) -> None:
        product = {
            "stages": [
                {"name": "Corte", "tracking_name": "Corte"},
                {"name": "Solda", "tracking_name": "Pré-acabado"},
            ],
            "tracking_stages": [
                {"process": "Corte", "stage": "BLANK"},
                {"process": "Pré-acabado", "stage": "PRE-ACABADO"},
            ],
        }
        totals = [
            {"process": "CORTE", "quantity": 500},
            {"process": "PRE-ACABADO", "quantity": 2371},
        ]

        self.assertEqual(_completed_pieces_from_last_process(product, totals), 2371)
        self.assertEqual(_completed_pieces_from_last_process(product, []), 0)

    def test_inventory_accepts_only_registered_processes_and_completes_only_the_last(self) -> None:
        product = {
            "stages": [
                {"name": "Corte", "tracking_name": "Corte"},
                {"name": "Solda", "tracking_name": "Pré-acabado"},
            ],
        }

        self.assertTrue(_inventory_process_valid(product, "Pré-acabado"))
        self.assertTrue(_inventory_process_valid(product, "PRE ACABADO"))
        self.assertFalse(_inventory_process_valid(product, "Laminação"))
        self.assertTrue(_inventory_process_valid(product, "Pré-acabado", completed=True))
        self.assertFalse(_inventory_process_valid(product, "Corte", completed=True))


if __name__ == "__main__":
    unittest.main()
