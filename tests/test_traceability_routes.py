from datetime import datetime, timezone
from decimal import Decimal
import unittest

from backend.traceability_routes import build_route_aliases, resolve_route
from backend.traceability_types import ProcessEvent


CNAT_ROUTE = ("CORTE", "REBAIXO", "FORJA", "REBARBA", "FURO", "LAMINACAO")


def event(*, machine: str, process: str = "CORTE", product_name: str = "CONECTOR AT") -> ProcessEvent:
    return ProcessEvent(
        source_key=f"APONTAMENTOS:{machine or 'SEM-MAQUINA'}:{process}",
        product_name=product_name,
        process=process,
        machine=machine,
        occurred_at=datetime(2026, 8, 31, 10, 0, tzinfo=timezone.utc),
        good_pieces=Decimal("100"),
        loss_pieces=Decimal("2"),
        operator="",
        shift="",
    )


class TraceabilityRouteTests(unittest.TestCase):
    def test_lathe_cut_combines_reduction_and_releases_forge(self) -> None:
        route = resolve_route(event(machine="Torno 01"), CNAT_ROUTE)

        self.assertTrue(route.resolved)
        self.assertEqual(route.current_step, "CORTE_REBAIXO")
        self.assertEqual(route.next_step, "FORJA")
        self.assertTrue(route.consumes_material)
        self.assertEqual(route.machine_group, "TORNO")

    def test_lathe_reduction_is_the_material_entry_and_releases_forge(self) -> None:
        route = resolve_route(event(machine="Torno", process="REBAIXO"), CNAT_ROUTE)

        self.assertTrue(route.resolved)
        self.assertEqual(route.current_step, "CORTE_REBAIXO")
        self.assertEqual(route.next_step, "FORJA")
        self.assertTrue(route.consumes_material)
        self.assertEqual(route.machine_group, "TORNO")

    def test_saw_cut_releases_only_reduction(self) -> None:
        route = resolve_route(event(machine="Serra 02"), CNAT_ROUTE)

        self.assertTrue(route.resolved)
        self.assertEqual(route.current_step, "CORTE")
        self.assertEqual(route.next_step, "REBAIXO")
        self.assertTrue(route.consumes_material)
        self.assertEqual(route.machine_group, "SERRA")

    def test_process_suffix_does_not_break_the_conector_at_machine_rule(self) -> None:
        route = resolve_route(
            event(machine="Torno 01", product_name="CONECTOR AT (BLANK)"),
            CNAT_ROUTE,
        )

        self.assertTrue(route.resolved)
        self.assertEqual(route.current_step, "CORTE_REBAIXO")
        self.assertEqual(route.next_step, "FORJA")

    def test_unknown_cut_machine_does_not_guess_route(self) -> None:
        route = resolve_route(event(machine=""), CNAT_ROUTE)

        self.assertFalse(route.resolved)
        self.assertIsNone(route.next_step)
        self.assertFalse(route.consumes_material)
        self.assertEqual(route.reason, "Máquina ausente ou desconhecida para a rota da Conector AT")

    def test_downstream_process_uses_registered_sequence(self) -> None:
        route = resolve_route(event(machine="Forja 1", process="FORJA"), CNAT_ROUTE)

        self.assertTrue(route.resolved)
        self.assertEqual(route.current_step, "FORJA")
        self.assertEqual(route.next_step, "REBARBA")
        self.assertFalse(route.consumes_material)


class RouteAliasTests(unittest.TestCase):
    """O chão de fábrica aponta SOLDA; a rota registra Pré-acabado."""

    CLAMP_PRODUCT = {
        "stages": [
            {"name": "Corte", "tracking_name": "Corte"},
            {"name": "Forja", "tracking_name": "Forja"},
            {"name": "Rebarba", "tracking_name": "Rebarba"},
            {"name": "Usinagem", "tracking_name": "Usinagem"},
            {"name": "Solda", "tracking_name": "Pré-acabado"},
        ],
    }
    CLAMP_ROUTE = ("CORTE", "FORJA", "REBARBA", "USINAGEM", "PRE_ACABADO")

    def test_alias_comes_from_the_catalog_not_de_um_mapa_inventado(self) -> None:
        self.assertEqual(build_route_aliases(self.CLAMP_PRODUCT), {"SOLDA": "PRE_ACABADO"})

    def test_operacao_apontada_como_solda_entra_como_pre_acabado(self) -> None:
        route = resolve_route(
            event(machine="Solda 1", process="SOLDA", product_name="SUPORTE 160"),
            self.CLAMP_ROUTE,
            build_route_aliases(self.CLAMP_PRODUCT),
        )

        self.assertTrue(route.resolved)
        self.assertEqual(route.current_step, "PRE_ACABADO")
        self.assertIsNone(route.next_step)

    def test_sem_a_ponte_o_apontamento_de_solda_fica_fora_da_rota(self) -> None:
        route = resolve_route(
            event(machine="Solda 1", process="SOLDA", product_name="SUPORTE 160"),
            self.CLAMP_ROUTE,
        )

        self.assertFalse(route.resolved)
        self.assertEqual(route.reason, "Processo não pertence à rota cadastrada")


if __name__ == "__main__":
    unittest.main()
