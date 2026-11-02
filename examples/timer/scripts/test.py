#!/usr/bin/env python3
"""Portable timer-owner checks; no SDK, phone or hardware claims."""
from pathlib import Path
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="activity-timer-test-") as scratch:
    binary = Path(scratch) / "timer-model"
    subprocess.run([
        os.environ.get("CC", "cc"), "-std=c99", "-Wall", "-Wextra", "-Werror", "-pedantic",
        str(root / "src/c/timer_model.c"), str(root / "tests/test_timer_model.c"),
        "-o", str(binary)
    ], check=True)
    subprocess.run([str(binary)], check=True)
subprocess.run(["node", "--test", str(root / "tests/handoff.test.js")], check=True)
