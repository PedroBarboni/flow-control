import unittest

from backend.main import _catalog_lot_identity


class CatalogTraceabilityReconciliationTest(unittest.TestCase):
    def test_placa_period_balance_is_identified_by_the_traced_material_lot(self) -> None:
        result = _catalog_lot_identity(
            visible_wip=3170,
            unidentified_wip=3170,
            traceability={
                "material": {"active_lot_id": "LT-5121-001"},
                "stages": [{
                    "lots": [{
                        "lot_id": "LT-5121-001-P001",
                        "material_lot_id": "LT-5121-001",
                        "pieces": 7410,
                    }],
                }],
                "unmatched_pieces": 0,
                "source_status": {"totvs": "online", "apontamentos": "online"},
            },
        )

        self.assertEqual(result["identified_in_process_pieces"], 3170)
        self.assertEqual(result["unidentified_in_process_pieces"], 0)
        self.assertEqual(result["material_lot_id"], "LT-5121-001")
        self.assertEqual(result["production_lot_id"], "LT-5121-001-P001")

    def test_unavailable_traceability_keeps_the_unidentified_balance(self) -> None:
        result = _catalog_lot_identity(3170, 3170, None)

        self.assertEqual(result["identified_in_process_pieces"], 0)
        self.assertEqual(result["unidentified_in_process_pieces"], 3170)
        self.assertIsNone(result["material_lot_id"])

    def test_consumed_material_lot_identifies_pieces_despite_other_stage_divergences(self) -> None:
        result = _catalog_lot_identity(
            visible_wip=1409,
            unidentified_wip=0,
            traceability={
                "material": {
                    "active_lot_id": "LT-5206-001",
                    "lots": [{
                        "lot_id": "LT-5206-001",
                        "transformed_pieces": 1409,
                        "consumed_kg": 198.669,
                    }],
                },
                "stages": [{
                    "lots": [{
                        "lot_id": "LT-5206-001-P001",
                        "material_lot_id": "LT-5206-001",
                        "pieces": 1407.7553,
                    }],
                }],
                "unmatched_pieces": 37672,
            },
        )

        self.assertEqual(result["identified_in_process_pieces"], 1409)
        self.assertEqual(result["unidentified_in_process_pieces"], 0)
        self.assertEqual(result["material_lot_id"], "LT-5206-001")
        self.assertEqual(result["production_lot_id"], "LT-5206-001-P001")


if __name__ == "__main__":
    unittest.main()
