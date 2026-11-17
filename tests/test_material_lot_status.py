"""Estado do lote de vergalhão: vem do consumo, não da posição na fila.

O FIFO sempre tem um "próximo lote a ser consumido". Isso não quer dizer
que ele já esteja em produção: um lote recém-transferido, com kg recebido
igual ao kg restante, está fechado até alguém cortar a primeira peça dele.
"""

from datetime import datetime, timezone
from decimal import Decimal
import unittest

from backend.traceability_engine import TraceabilityLedger
from backend.traceability_types import ProcessEvent


ROUTE = ("CORTE", "FORJA", "REBARBA", "USINAGEM", "PRE_ACABADO")
NOW = datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc)


def cut(key: str, good: str) -> ProcessEvent:
    return ProcessEvent(
        source_key=key,
        product_name="CONECTOR BT 400",
        process="CORTE",
        machine="SERRA 01",
        occurred_at=NOW,
        good_pieces=Decimal(good),
        loss_pieces=Decimal("0"),
        operator="Pedro",
        shift="1",
    )


def classify(lot: dict[str, float]) -> str:
    """Mesma regra do endpoint, aplicada sobre o snapshot do razão."""
    balance = float(lot["balance_kg"])
    consumed = float(lot["consumed_kg"])
    if consumed <= 0.001:
        return "fechado"
    if balance <= 0.001:
        return "consumido"
    return "em_processo"


class MaterialLotStatusTests(unittest.TestCase):
    def _snapshot(self, *events: ProcessEvent) -> dict[str, dict[str, float]]:
        ledger = TraceabilityLedger("conector-bt-400", Decimal("0.470"))
        ledger.add_material_lot("LT-5495-001", Decimal("1721"), NOW)
        ledger.add_material_lot("LT-5495-002", Decimal("1191"), NOW)
        for event in events:
            ledger.apply(event, ROUTE)
        return {row["lot_id"]: row for row in ledger.snapshot()["material_lots"]}

    def test_untouched_lot_is_closed_even_being_next_in_the_fifo(self) -> None:
        lots = self._snapshot()

        # Os dois com kg recebido igual ao restante: ninguém encostou.
        self.assertEqual(classify(lots["LT-5495-001"]), "fechado")
        self.assertEqual(classify(lots["LT-5495-002"]), "fechado")

    def test_lot_enters_process_only_after_the_first_piece_is_cut(self) -> None:
        lots = self._snapshot(cut("A:1", "100"))

        self.assertEqual(classify(lots["LT-5495-001"]), "em_processo")
        # O segundo continua fechado: o FIFO nem chegou nele.
        self.assertEqual(classify(lots["LT-5495-002"]), "fechado")

    def test_exhausted_lot_is_consumed_and_the_next_one_takes_over(self) -> None:
        # 1721 kg / 0,470 = 3661,7 peças; 3700 esgotam o primeiro lote.
        lots = self._snapshot(cut("A:1", "3700"))

        self.assertEqual(classify(lots["LT-5495-001"]), "consumido")
        self.assertEqual(classify(lots["LT-5495-002"]), "em_processo")


if __name__ == "__main__":
    unittest.main()
