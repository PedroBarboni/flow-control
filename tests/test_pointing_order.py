"""Ordem de digitação x ordem física.

A pergunta que o chão de fábrica faz: "se eu apontar na sequência errada,
o sistema acusa divergência?". A resposta tem que ser não para a ordem de
DIGITAÇÃO e sim para a inversão de DATA — e isso precisa estar travado,
porque é a diferença entre confiar e não confiar no alerta.
"""

from datetime import datetime, timezone
from decimal import Decimal
import unittest

from backend.traceability_service import build_traceability_snapshot
from backend.traceability_types import ProcessEvent


PRODUCT = {
    "id": "placa-160",
    "code": "5119",
    "name": "Placa 160",
    "blank_weight_kg": 0.323,
    "stages": [
        {"name": "Corte", "tracking_name": "Corte"},
        {"name": "Forja", "tracking_name": "Forja"},
        {"name": "Solda", "tracking_name": "Pré-acabado"},
    ],
    "tracking_stages": [
        {"process": "Corte"},
        {"process": "Forja"},
        {"process": "Pré-acabado"},
    ],
}
TOTVS = {"lots": [{"id": "LT-5121-001", "initial_kg": 1000, "date": "01/09/2026"}]}
DIA_3 = datetime(2026, 9, 3, tzinfo=timezone.utc)
DIA_4 = datetime(2026, 9, 4, tzinfo=timezone.utc)


def pointing(key: str, process: str, machine: str, good: str, quando: datetime) -> ProcessEvent:
    return ProcessEvent(
        source_key=key,
        product_name="PLACA 160",
        process=process,
        machine=machine,
        occurred_at=quando,
        good_pieces=Decimal(good),
        loss_pieces=Decimal("0"),
        operator="Pedro",
        shift="1",
    )


def unmatched(snapshot: dict) -> float:
    return float(snapshot["unmatched_pieces"])


class PointingOrderTests(unittest.TestCase):
    def _snapshot(self, eventos: list[ProcessEvent]) -> dict:
        return build_traceability_snapshot(PRODUCT, TOTVS, [], eventos)

    def test_typing_the_stages_backwards_on_the_same_day_creates_no_divergence(self) -> None:
        """Digitar Solda antes do Corte no mesmo dia não pode acusar nada.

        O apontamento guarda só a data: o dia inteiro cai na meia-noite e a
        ordem de digitação não representa a sequência física. Quem apontou a
        Solda primeiro fez o serviço na ordem certa mesmo assim.
        """
        de_tras_para_frente = [
            pointing("A:3", "SOLDA", "SOLDA 1", "100", DIA_3),
            pointing("A:2", "FORJA", "FORJA 3", "100", DIA_3),
            pointing("A:1", "CORTE", "SERRA 01", "100", DIA_3),
        ]

        self.assertEqual(unmatched(self._snapshot(de_tras_para_frente)), 0.0)

    def test_the_result_does_not_depend_on_the_order_the_rows_arrive(self) -> None:
        na_ordem = [
            pointing("A:1", "CORTE", "SERRA 01", "100", DIA_3),
            pointing("A:2", "FORJA", "FORJA 3", "100", DIA_3),
            pointing("A:3", "SOLDA", "SOLDA 1", "100", DIA_3),
        ]
        invertido = list(reversed(na_ordem))

        self.assertEqual(unmatched(self._snapshot(na_ordem)), unmatched(self._snapshot(invertido)))

    def test_a_stage_dated_before_the_previous_one_does_create_a_divergence(self) -> None:
        """Data manda. Soldar dia 3 o que só foi forjado dia 4 é inversão real."""
        invertido_na_data = [
            pointing("A:1", "CORTE", "SERRA 01", "100", DIA_3),
            pointing("A:2", "SOLDA", "SOLDA 1", "100", DIA_3),
            pointing("A:3", "FORJA", "FORJA 3", "100", DIA_4),
        ]

        self.assertEqual(unmatched(self._snapshot(invertido_na_data)), 100.0)

    def test_the_same_work_dated_in_sequence_reconciles(self) -> None:
        """Mesmos apontamentos, datas na ordem física: nada sobra."""
        em_sequencia = [
            pointing("A:1", "CORTE", "SERRA 01", "100", DIA_3),
            pointing("A:3", "FORJA", "FORJA 3", "100", DIA_3),
            pointing("A:2", "SOLDA", "SOLDA 1", "100", DIA_4),
        ]

        self.assertEqual(unmatched(self._snapshot(em_sequencia)), 0.0)


if __name__ == "__main__":
    unittest.main()
