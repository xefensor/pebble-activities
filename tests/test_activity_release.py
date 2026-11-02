"""Library-only release packaging and integrity regressions; no SDK/network."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import test_github_release as generic


REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("package_release", REPO / "scripts/package-release.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class LibraryPackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "package.json").write_text(json.dumps({"name": "fixture", "version": "1.2.3"}))

    def npm_pack(self, args, **kwargs):
        self.assertEqual(kwargs["cwd"], self.root)
        destination = Path(args[args.index("--pack-destination") + 1])
        (destination / "fixture-1.2.3.tgz").write_bytes(b"fixture tar")
        return subprocess.CompletedProcess(args, 0, json.dumps([{"filename": "fixture-1.2.3.tgz"}]), "")

    def test_packages_without_any_timer_checkout_or_pbw(self):
        sdk_contents = {"js/index.js": b"module.exports={};\n"}
        (self.root / "dist.zip").write_bytes(generic.zip_bytes(sdk_contents))
        with patch.object(packager.subprocess, "run", side_effect=self.npm_pack):
            packager.package(self.root)
        artifacts = list((self.root / "releases").iterdir())
        self.assertEqual({path.name for path in artifacts}, {"fixture-1.2.3.tgz", "SHA256SUMS.txt"})
        sums = (self.root / "releases/SHA256SUMS.txt").read_bytes()
        paths = ["dist.zip", "releases/fixture-1.2.3.tgz"]
        hashes = generic.release.checksum_map(sums, paths, "releases/SHA256SUMS.txt")
        for name in paths:
            self.assertEqual(hashes[name], generic.release.digest((self.root / name).read_bytes()))
        with zipfile.ZipFile(self.root / "dist.zip") as archive:
            self.assertEqual({name: archive.read(name) for name in archive.namelist()}, sdk_contents)

    def test_packaging_preserves_historical_timer_and_library_artifacts(self):
        old = {"Activity-Timer-0.1.0.pbw": b"old timer", "pebble-activities-0.1.0.tgz": b"old package"}
        releases = self.root / "releases"
        releases.mkdir()
        for name, content in old.items():
            (releases / name).write_bytes(content)
        (self.root / "dist.zip").write_bytes(generic.zip_bytes({"js/index.js": b"SDK"}))
        with patch.object(packager.subprocess, "run", side_effect=self.npm_pack):
            packager.package(self.root)
        for name, content in old.items():
            self.assertEqual((releases / name).read_bytes(), content)
        self.assertNotIn(".pbw", (releases / "SHA256SUMS.txt").read_text())

    def test_unbuilt_or_corrupt_sdk_does_not_touch_release_files(self):
        releases = self.root / "releases"
        releases.mkdir()
        sums = releases / "SHA256SUMS.txt"
        sums.write_bytes(b"unchanged")
        with patch.object(packager.subprocess, "run") as npm:
            with self.assertRaises(FileNotFoundError):
                packager.package(self.root)
            (self.root / "dist.zip").write_bytes(b"corrupt SDK")
            with self.assertRaises(zipfile.BadZipFile):
                packager.package(self.root)
            npm.assert_not_called()
        self.assertEqual(sums.read_bytes(), b"unchanged")


class LibraryReleaseTests(unittest.TestCase):
    setUp = generic.ReleaseTests.setUp
    tearDown = generic.ReleaseTests.tearDown
    run_git = generic.ReleaseTests.run_git
    write = generic.ReleaseTests.write
    commit = generic.ReleaseTests.commit

    def test_activities_release_accepts_only_library_artifacts(self):
        assets = {name: (self.root / name).read_bytes()
                  for name in ["dist.zip", "releases/fixture-1.2.3.tgz"]}
        config = {**self.config, "kind": "activities"}
        generic.release.validate_artifacts(self.root, config, self.original, self.package, assets)
        with self.assertRaisesRegex(ValueError, "only the library"):
            generic.release.validate_artifacts(self.root, config, self.original, self.package,
                {**assets, "releases/Activity-Timer-1.2.3.pbw": b"unrelated app"})


if __name__ == "__main__":
    unittest.main()
