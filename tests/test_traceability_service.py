"""Contrato da projeção de rastreabilidade.

Regra central: a posição do inventário de abertura nomeia a operação que a peça
JÁ sofreu. A pilha do Corte são blanks cortados aguardando o Rebaixo; a pilha do
Rebaixo — inclusive a que saiu do torno — aguarda a Forja. Por isso a posição
entra na fila da operação SEGUINTE, que é quem vai consumi-la.
"""

from datetime import datetime, timezone
from decimal import Decimal
import unittest

from backend.traceability_service import build_traceability_snapshot
from backend.traceability_types import ProcessEvent


CONECTOR_AT = {
    "id": "conector-at", "name": "Conector AT", "code": "5205",
    "blank_weight_kg": 0.141,
    "tracking_stages": [
        {"process": "Corte"}, {"process": "Rebaixo"}, {"process": "Forja"},
        {"process": "Rebarba"}, {"process": "Furo"}, {"process": "Laminacao"},
    ],
}

BT_400 = {
    "id": "conector-bt-400", "name": "Conector BT 400", "code": "5494",
    "blank_weight_kg": 0.470,
    "tracking_stages": [
        {"process": "Corte"}, {"process": "Rebaixo"}, {"process": "Forja"},
        {"process": "Rebarba"}, {"process": "Furo"}, {"process": "Laminacao"},
    ],
}

MEIA_NOITE = datetime(2026, 9, 2, tzinfo=timezone.utc)


def posicao(process: str, pieces: float, status: str = "waiting") -> dict:
    return {
        "process": process, "piece_quantity": pieces,
        "position_status": status, "reference_date": "2026-09-01",
    }


def apontamento(
    source: str, produto: str, process: str, machine: str,
    boas: str, perda: str = "0", quando: datetime = MEIA_NOITE,
) -> ProcessEvent:
    return ProcessEvent(
        source, produto, process, machine, quando, Decimal(boas), Decimal(perda), "", ""
    )


def por_processo(snapshot: dict) -> dict:
    return {row["process"]: row for row in snapshot["stages"]}


class OpeningPositionQueueTests(unittest.TestCase):
    """Onde a posição do inventário entra na fila."""

    def test_position_waits_for_the_next_operation_not_its_own(self) -> None:
        """A pilha da Rebarba é consumida pelo Furo, não pela própria Rebarba."""
        snapshot = build_traceability_snapshot(
            CONECTOR_AT, {"lots": []}, [posicao("Rebarba", 3010)],
            [apontamento("APONTAMENTOS:1", "CONECTOR AT", "FURO", "CNC 1", "1728")],
        )

        estagios = por_processo(snapshot)
        self.assertEqual(estagios["FURO"]["available_pieces"], 3010 - 1728)
        self.assertEqual(estagios["REBARBA"]["available_pieces"], 0)
        self.assertEqual(snapshot["unmatched_pieces"], 0.0)

    def test_cut_pile_waits_for_the_rebaixo(self) -> None:
        """Blank cortado não pode alimentar o próprio Corte: a entrada dele é vergalhão."""
        snapshot = build_traceability_snapshot(
            BT_400, {"lots": []}, [posicao("Corte", 4233)], [],
        )

        estagios = por_processo(snapshot)
        self.assertEqual(estagios["REBAIXO"]["opening_pieces"], 4233)
        self.assertEqual(estagios["CORTE"]["opening_pieces"], 0)

    def test_position_on_the_last_operation_is_finished_goods(self) -> None:
        """Saída da última operação é peça pronta, não fila de processo."""
        snapshot = build_traceability_snapshot(
            BT_400, {"lots": []},
            [posicao("Laminacao", 5388), posicao("Furo", 1160)],
            [],
        )

        estagios = por_processo(snapshot)
        self.assertEqual(estagios["LAMINACAO"]["opening_pieces"], 1160)
        self.assertEqual(
            sum(row["opening_pieces"] for row in snapshot["stages"]), 1160,
            "a pilha da última operação não pode virar fila de nenhuma etapa",
        )

    def test_completed_inventory_does_not_remain_in_process_queues(self) -> None:
        placa_400 = {
            "id": "placa-400", "name": "Placa 400", "code": "5160",
            "blank_weight_kg": 0.804,
            "tracking_stages": [
                {"process": "Corte"}, {"process": "Forja"}, {"process": "Rebarba"},
                {"process": "Usinagem"}, {"process": "Pré-acabado"},
            ],
        }
        snapshot = build_traceability_snapshot(
            placa_400, {"lots": []},
            [posicao("Corte", 338), posicao("Pré-acabado", 2371, status="completed")],
            [],
        )

        estagios = por_processo(snapshot)
        self.assertEqual(estagios["FORJA"]["opening_pieces"], 338)
        self.assertEqual(estagios["CORTE"]["opening_pieces"], 0)
        self.assertEqual(estagios["PRE_ACABADO"]["opening_pieces"], 0)


class CascadeTests(unittest.TestCase):
    """A cascata: cada operação consome a saída da anterior."""

    def test_opening_wip_and_new_material_flow_stay_separate(self) -> None:
        totvs = {"lots": [{"id": "LT-5205-001", "initial_kg": 500, "date": "30/08/2026"}]}
        opening = [posicao("Rebaixo", 1200)]
        events = [
            apontamento("AP:1", "CONECTOR AT", "FORJA", "FORJA 1", "100",
                        quando=datetime(2026, 8, 31, 8, tzinfo=timezone.utc)),
            apontamento("AP:2", "CONECTOR AT", "CORTE", "SERRA 01", "100",
                        quando=datetime(2026, 8, 31, 9, tzinfo=timezone.utc)),
        ]

        snapshot = build_traceability_snapshot(CONECTOR_AT, totvs, opening, events)

        estagios = por_processo(snapshot)
        self.assertEqual(snapshot["material"]["remaining_kg"], 485.9)
        self.assertEqual(estagios["REBAIXO"]["identified_pieces"], 100.0)
        self.assertEqual(estagios["FORJA"]["opening_pieces"], 1100.0)
        self.assertEqual(estagios["REBARBA"]["opening_pieces"], 100.0)
        self.assertEqual(snapshot["unmatched_pieces"], 0.0)

    def test_bt400_cut_after_transfer_consumes_rod_and_feeds_the_rebaixo(self) -> None:
        totvs = {"lots": [{"id": "LT-BT400-001", "initial_kg": 1000, "date": "01/09/2026"}]}
        opening = [posicao("Corte", 1724)]
        events = [
            apontamento("AP:BT400:1", "CONECTOR BT 400", "CORTE", "SERRA", "100", "2",
                        quando=datetime(2026, 9, 1, 10, tzinfo=timezone.utc)),
        ]

        snapshot = build_traceability_snapshot(BT_400, totvs, opening, events)

        estagios = por_processo(snapshot)
        self.assertEqual(snapshot["material"]["consumed_kg"], 47.94)
        lote = snapshot["material"]["lots"][0]
        self.assertEqual(lote["lot_id"], "LT-BT400-001")
        self.assertEqual(lote["transformed_pieces"], 100.0)
        self.assertEqual(estagios["REBAIXO"]["identified_pieces"], 100.0)
        self.assertEqual(estagios["REBAIXO"]["opening_pieces"], 1724.0)
        self.assertEqual(estagios["REBAIXO"]["lots"][-1]["material_lot_id"], "LT-BT400-001")


class IntradayOrderTests(unittest.TestCase):
    """Ordem de consumo dentro do mesmo instante."""

    def _piles(self) -> list[dict]:
        # Rebarba alimenta o Furo; Furo alimenta a Laminação.
        return [posicao("Rebarba", 1160), posicao("Furo", 1000)]

    def test_same_day_events_are_consumed_in_route_order_not_record_order(self) -> None:
        """O apontamento guarda só a data: o id do registro não é sequência física.

        A Laminação foi digitada antes do Furo, mas no chão de fábrica ela só
        consome o que o Furo entregou.
        """
        events = [
            apontamento("APONTAMENTOS:1", "CONECTOR BT 400", "LAMINACAO", "LAMI. 1", "1609"),
            apontamento("APONTAMENTOS:9", "CONECTOR BT 400", "FURO", "CNC 3", "643"),
        ]

        snapshot = build_traceability_snapshot(BT_400, {"lots": []}, self._piles(), events)

        estagios = por_processo(snapshot)
        self.assertEqual(snapshot["unmatched_pieces"], 0.0)
        self.assertEqual(estagios["FURO"]["available_pieces"], 1160 - 643)
        self.assertEqual(estagios["LAMINACAO"]["available_pieces"], 1000 + 643 - 1609)

    def test_real_timestamps_still_win_over_route_order(self) -> None:
        """Com hora real, a cronologia manda: inversão física continua divergente."""
        events = [
            apontamento("APONTAMENTOS:1", "CONECTOR BT 400", "LAMINACAO", "LAMI. 1", "1609",
                        quando=datetime(2026, 9, 2, 8, tzinfo=timezone.utc)),
            apontamento("APONTAMENTOS:9", "CONECTOR BT 400", "FURO", "CNC 3", "643",
                        quando=datetime(2026, 9, 2, 10, tzinfo=timezone.utc)),
        ]

        snapshot = build_traceability_snapshot(BT_400, {"lots": []}, self._piles(), events)

        self.assertEqual(snapshot["unmatched_pieces"], 609.0)

    def test_operation_outside_the_route_is_consumed_last(self) -> None:
        """Processo fora da rota não fura a fila das operações cadastradas."""
        events = [
            apontamento("APONTAMENTOS:1", "CONECTOR BT 400", "OPERACAO DESCONHECIDA", "X", "50"),
            apontamento("APONTAMENTOS:2", "CONECTOR BT 400", "FURO", "CNC 3", "700"),
        ]

        snapshot = build_traceability_snapshot(
            BT_400, {"lots": []}, [posicao("Rebarba", 700)], events,
        )

        estagios = por_processo(snapshot)
        self.assertEqual(estagios["FURO"]["available_pieces"], 0.0)
        self.assertEqual(estagios["LAMINACAO"]["available_pieces"], 700.0)
        self.assertEqual(snapshot["unmatched_pieces"], 50.0)


if __name__ == "__main__":
    unittest.main()
