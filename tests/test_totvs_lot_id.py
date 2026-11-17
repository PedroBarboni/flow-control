import unittest

from backend.totvs import _lot_id


class TotvsLotIdTests(unittest.TestCase):
    def test_generated_lot_uses_destination_piece_code_and_sequence(self) -> None:
        movement = {
            "destino": "005121",
            "lotSequence": 1,
            "dataMovimento": "20260828",
            "documento": "000080013",
            "registro": 515360,
        }

        self.assertEqual(_lot_id(movement), "LT-5121-001")

    def test_generated_lot_keeps_traceability_fields_out_of_short_identifier(self) -> None:
        movement = {
            "destino": "5121",
            "lotSequence": 12,
            "dataMovimento": "20260904",
            "documento": "000099999",
            "registro": 999999,
        }

        self.assertEqual(_lot_id(movement), "LT-5121-012")


if __name__ == "__main__":
    unittest.main()
