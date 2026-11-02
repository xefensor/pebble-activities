#!/usr/bin/env python3
"""Portable strict-C activity wire/state checks; no Pebble SDK required."""

from pathlib import Path
import os
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def main():
    compiler = os.environ.get("CC", "cc")
    with tempfile.TemporaryDirectory(prefix="pebble-activities-native-") as directory:
        output = Path(directory) / "activity-tests"
        command = [compiler, "-std=c99", "-Wall", "-Wextra", "-Werror", "-pedantic",
                   "-I", str(ROOT / "include"),
                   str(ROOT / "tests/native/activity.c"),
                   str(ROOT / "src/c/pebble-activities.c"), "-lm", "-o", str(output)]
        if os.environ.get("PA_SANITIZE") == "1":
            command[1:1] = ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
        subprocess.run(command, check=True)
        subprocess.run([str(output), str(ROOT / "tests/fixtures")], check=True)


if __name__ == "__main__":
    main()
