import unittest
from datetime import datetime, timezone
from decimal import Decimal

from backend.database import _event_from_payload, _event_to_payload, _resolve_event_columns
from backend.traceability_types import ProcessEvent


class ProcessEventColumnTests(unittest.TestCase):
    def test_resolves_machine_and_stable_pointing_identifier(self) -> None:
        columns = {
            "id", "produto", "processo", "maquina", "data", "quantidade",
            "perda", "operador", "turno",
        }

        self.assertEqual(_resolve_event_columns(columns), {
            "id": "id", "product": "produto", "process": "processo",
            "machine": "maquina", "date": "data", "quantity": "quantidade",
            "loss": "perda", "operator": "operador", "shift": "turno",
        })

    def test_missing_machine_is_rejected_instead_of_guessing(self) -> None:
        columns = {"id", "produto", "processo", "data", "quantidade", "perda"}

        with self.assertRaisesRegex(RuntimeError, "machine"):
            _resolve_event_columns(columns)

    def test_event_survives_the_database_runtime_fallback(self) -> None:
        event = ProcessEvent(
            source_key="APONTAMENTOS:42",
            product_name="CONECTOR AT",
            process="CORTE",
            machine="Torno 01",
            occurred_at=datetime(2026, 8, 31, 8, 30, tzinfo=timezone.utc),
            good_pieces=Decimal("100"),
            loss_pieces=Decimal("2"),
            operator="Pedro",
            shift="1",
        )

        restored = _event_from_payload(_event_to_payload(event))

        self.assertEqual(restored, event)


if __name__ == "__main__":
    unittest.main()
