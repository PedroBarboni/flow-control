import os
import unittest
from unittest.mock import patch

from backend.local_environment import load_local_environment


class LocalEnvironmentTests(unittest.TestCase):
    def test_loads_local_values_without_overwriting_process_configuration(self) -> None:
        class EnvironmentFile:
            def is_file(self) -> bool:
                return True

            def read_text(self, encoding: str) -> str:
                self.assert_encoding = encoding
                return "FLOW_TEST_VALUE=arquivo\nFLOW_NEW_VALUE=novo\n"

        with patch.dict(os.environ, {"FLOW_TEST_VALUE": "processo"}, clear=False):
            os.environ.pop("FLOW_NEW_VALUE", None)
            load_local_environment(EnvironmentFile())
            self.assertEqual(os.environ["FLOW_TEST_VALUE"], "processo")
            self.assertEqual(os.environ["FLOW_NEW_VALUE"], "novo")
            os.environ.pop("FLOW_NEW_VALUE", None)


if __name__ == "__main__":
    unittest.main()
