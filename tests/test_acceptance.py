"""Regression checks for the verification runner's failure and timeout handling."""

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "acceptance_runner", Path(__file__).resolve().parent.parent / "scripts/check-wikipedia.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class AcceptanceRunnerTests(unittest.TestCase):
    def test_failure_is_preserved_with_its_output(self):
        with tempfile.TemporaryDirectory() as directory:
            logs = Path(directory)
            with patch.object(runner, "LOGS", logs), patch.object(runner, "ROOT", logs):
                result = runner.run_check("failure.log", [sys.executable, "-c",
                    "print('expected diagnostic'); raise SystemExit(7)"], 3)
            self.assertEqual(result["exitCode"], 7)
            self.assertIn("expected diagnostic", (logs / "failure.log").read_text())

    def test_watchdog_reports_timeout_instead_of_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            logs = Path(directory)
            with patch.object(runner, "LOGS", logs), patch.object(runner, "ROOT", logs):
                result = runner.run_check("timeout.log", [sys.executable, "-c",
                    "import time; time.sleep(30)"], 0.05)
            self.assertEqual(result["exitCode"], 124)
            self.assertIn("deadline exceeded", (logs / "timeout.log").read_text())
