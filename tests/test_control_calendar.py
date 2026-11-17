from datetime import date
import unittest

from backend.control_calendar import control_schedule, current_cycle_range, traceability_range


class ControlCalendarTests(unittest.TestCase):
    def test_control_starts_today_and_inventory_is_scheduled_for_september_first(self) -> None:
        schedule = control_schedule(date(2026, 8, 28))

        self.assertEqual(schedule, {
            "operational": True,
            "mode": "operational",
            "starts_at": "2026-08-28",
            "starts_at_label": "28/08/2026",
            "reset_at": "2026-09-01",
            "reset_at_label": "01/09/2026",
            "inventory_at": "2026-09-01",
            "inventory_at_label": "01/09/2026",
            "inventory_required": False,
            "inventory_fields": ["piece", "process", "piece_quantity", "rod_kg_in_process"],
        })

    def test_current_cycle_resets_without_deleting_history_on_september_first(self) -> None:
        self.assertEqual(current_cycle_range(date(2026, 8, 30)), (date(2026, 8, 28), date(2026, 8, 30)))
        self.assertEqual(current_cycle_range(date(2026, 9, 1)), (date(2026, 9, 1), date(2026, 9, 1)))
        self.assertEqual(current_cycle_range(date(2026, 9, 2)), (date(2026, 9, 1), date(2026, 9, 2)))

    def test_inventory_becomes_required_on_september_first(self) -> None:
        self.assertFalse(control_schedule(date(2026, 8, 31))["inventory_required"])
        self.assertTrue(control_schedule(date(2026, 9, 1))["inventory_required"])

    def test_traceability_keeps_lot_history_before_the_production_reset(self) -> None:
        """A tela pode filtrar setembro sem apagar a formação do lote em agosto."""
        self.assertEqual(
            traceability_range("2026-09-01", "2026-09-01", date(2026, 9, 1)),
            (date(2026, 8, 28), date(2026, 9, 1)),
        )

    def test_traceability_does_not_read_after_the_requested_end(self) -> None:
        self.assertEqual(
            traceability_range("2026-08-28", "2026-08-31", date(2026, 9, 1)),
            (date(2026, 8, 28), date(2026, 8, 31)),
        )


if __name__ == "__main__":
    unittest.main()
