"""Reference-app release integrity and packaging regressions; no SDK/network."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import uuid

import test_github_release as generic

release = generic.release
zip_bytes = generic.zip_bytes


REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("package_release", REPO / "scripts/package-release.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class TimerReleaseTests(unittest.TestCase):
    run_git = generic.ReleaseTests.run_git
    write = generic.ReleaseTests.write
    commit = generic.ReleaseTests.commit

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run_git("init", "-b", "main")
        self.run_git("config", "user.name", "Release Test")
        self.run_git("config", "user.email", "test@example.invalid")
        self.package = {"version": "1.2.3"}
        self.app_uuid = "50e9ef12-a5ab-4369-a3b5-3447bfba5151"
        self.timer = {"version": "1.2.3", "pebble": {"uuid": self.app_uuid,
            "plugin": {"script": "plugin.js", "sources": [{"category": "activity", "items": ["session"],
                "properties": {"unconfirmed": ["boolean"]}}]},
            "targetPlatforms": ["emery"], "usesPermissions": [], "messageKeys": {"ACTIVITY_RUN": 1001}}}
        source = {"src/js/wire.js": "module.exports={version:1};\n",
            "src/js/publisher.js": "var wire=require('./wire');\nmodule.exports=wire;\n",
            "publisher.js": "module.exports=require('./src/js/publisher');\n",
            "examples/timer/src/plugin/index.js": "var provider=require('pebble-activities/publisher');\n",
            "examples/timer/src/pkjs/index.js": "var publisher=require('pebble-activities/publisher');\n"}
        for path, text in source.items():
            self.write(path, text.encode())
        self.write("LICENSE", b"fixture license")
        self.write("examples/timer/THIRD-PARTY-NOTICES.md", b"fixture SDK notice")
        self.write("examples/timer/licenses/Apache-2.0.txt", b"fixture Apache license")
        self.write("package.json", json.dumps(self.package).encode())
        self.write("examples/timer/package.json", json.dumps(self.timer).encode())
        self.write("scripts/bundle-js.py", (REPO / "scripts/bundle-js.py").read_bytes())
        self.write("scripts/verify-timer-bundle.js", b"require('fs').accessSync(process.argv[2]+'/plugin.js');\n")
        plugin = self.root / "plugin.js"
        subprocess.run(["python3", str(self.root / "scripts/bundle-js.py"),
            str(self.root / "examples/timer/src/plugin/index.js"), str(plugin)], check=True)
        native = bytearray(128)
        native[:8] = b"PBLAPP\0\0"
        native[8:10] = bytes((16, 0))
        native[12:14] = bytes((1, 2))
        native[104:120] = uuid.UUID(self.app_uuid).bytes
        resource = bytes(range(128))
        manifest = {"manifestVersion": 2, "type": "application",
            "application": {"name": "pebble-app.bin", "size": len(native), "crc": release.pebble_crc(native)},
            "resources": {"name": "app_resources.pbpack", "size": len(resource), "crc": release.pebble_crc(resource)}}
        paths = ["_pkjs_shared_additions.js", "./src/pkjs/index.js", "publisher.js", "wire.js"]
        texts = ["var sdk=true;\n", source["examples/timer/src/pkjs/index.js"],
            source["src/js/publisher.js"], source["src/js/wire.js"]]
        mapped, modules = [], ["/* 0 */\n/***/ (function(module, exports, __webpack_require__) {\n\n"
            "\t__webpack_require__(1);\n\tmodule.exports = __webpack_require__(2);\n\n/***/ })"]
        for number, text in enumerate(texts, 1):
            mapped.append(text + "\n\n//////////////////\n// WEBPACK FOOTER\n// module id = " + str(number) + "\n")
            compiled = text.replace("require('pebble-activities/publisher')", "__webpack_require__(3)")
            compiled = compiled.replace("require('./wire')", "__webpack_require__(4)")
            modules.append("/* %d */\n/***/ (function(module, exports, __webpack_require__) {\n\n" % number +
                "\n".join("\t" + line for line in compiled.rstrip().splitlines()) + "\n\n/***/ })")
        info = {**self.timer["pebble"], "versionLabel": "1.2.3", "manifestVersion": 2,
            "watchapp": {"watchface": False}, "projectType": "native", "appKeys": {"ACTIVITY_RUN": 1001}}
        self.pbw = {"appinfo.json": json.dumps(info).encode(), "LICENSE": b"fixture license",
            "THIRD-PARTY-NOTICES.md": b"fixture SDK notice", "licenses/Apache-2.0.txt": b"fixture Apache license",
            "plugin.js": plugin.read_bytes(), "pebble-js-app.js": ",\n".join(modules).encode(),
            "pebble-js-app.js.map": json.dumps({"sources": paths, "sourcesContent": mapped}).encode(),
            "emery/pebble-app.bin": bytes(native), "emery/app_resources.pbpack": resource,
            "emery/manifest.json": json.dumps(manifest).encode()}
        self.config = {"reference_timer": {"source": "examples/timer", "app_uuid": self.app_uuid,
            "path": "releases/Activity-Timer-{version}.pbw"}}
        self.commit_sha = self.commit()

    def validate(self, pbw=None):
        release.validate_reference_timer(self.root, self.config, self.commit_sha, self.package,
            {"releases/Activity-Timer-1.2.3.pbw": zip_bytes(pbw or self.pbw)})

    def mutate_json(self, name, mutate):
        files = dict(self.pbw)
        value = json.loads(files[name])
        mutate(value)
        files[name] = json.dumps(value).encode()
        return files

    def test_actual_packaged_fields_and_committed_bundles_validate(self):
        self.validate()

    def test_full_version_uuid_and_plugin_manifest_cannot_drift(self):
        for field, value in [("versionLabel", "1.2.4"), ("uuid", "0" * 36),
                ("manifestVersion", 1), ("plugin", {"script": "missing.js"}), ("appKeys", {})]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.validate(self.mutate_json("appinfo.json", lambda info: info.update({field: value})))

    def test_license_and_plugin_bytes_must_match_committed_sources(self):
        for name in ["LICENSE", "THIRD-PARTY-NOTICES.md", "licenses/Apache-2.0.txt", "plugin.js"]:
            with self.subTest(member=name), self.assertRaises(ValueError):
                self.validate({**self.pbw, name: b"stale"})

    def test_pkjs_map_and_executed_module_both_must_match(self):
        for name in ["pebble-js-app.js", "pebble-js-app.js.map"]:
            with self.subTest(member=name), self.assertRaises(ValueError):
                self.validate({**self.pbw, name: self.pbw[name].replace(b"version:1", b"version:2")})

    def test_native_binary_and_resource_integrity_are_checked(self):
        for name in ["emery/pebble-app.bin", "emery/app_resources.pbpack"]:
            with self.subTest(member=name), self.assertRaisesRegex(ValueError, "native integrity"):
                self.validate({**self.pbw, name: self.pbw[name][:-1] + b"x"})

    def test_crc_correct_native_wrong_uuid_version_or_header_is_rejected(self):
        for offset in [8, 12, 104]:
            with self.subTest(offset=offset):
                files = dict(self.pbw)
                native = bytearray(files["emery/pebble-app.bin"])
                native[offset] ^= 1
                files["emery/pebble-app.bin"] = bytes(native)
                manifest = json.loads(files["emery/manifest.json"])
                manifest["application"]["crc"] = release.pebble_crc(native)
                files["emery/manifest.json"] = json.dumps(manifest).encode()
                with self.assertRaisesRegex(ValueError, "native identity/version"):
                    self.validate(files)

    def test_missing_platform_or_native_manifest_is_rejected(self):
        files = dict(self.pbw)
        del files["emery/manifest.json"]
        with self.assertRaisesRegex(ValueError, "platform set"):
            self.validate(files)

    def test_bundled_runtime_failure_blocks_release(self):
        self.write("scripts/verify-timer-bundle.js", b"process.exit(7);\n")
        self.commit_sha = self.commit()
        with self.assertRaisesRegex(ValueError, "bundled-runtime handoff failed"):
            self.validate()

    def test_pebble_crc_matches_published_sdk_vectors(self):
        self.assertEqual(release.pebble_crc(b"123 567 901 34"), 0x89f3bab2)
        self.assertEqual(release.pebble_crc(b"123456789"), 0xaff19057)
        self.assertEqual(release.pebble_crc(b"\xfe\xff\xfe\xff\x88"), 0x495e02ca)

    def test_packaging_copies_latest_timer_and_checksums_all_downloads(self):
        self.write("dist.zip", zip_bytes({"js/index.js": b"SDK"}))
        self.write("examples/timer/dist/Activity-Timer-1.2.3.pbw", zip_bytes(self.pbw))
        def npm_pack(args, **kwargs):
            destination = Path(args[args.index("--pack-destination") + 1])
            (destination / "fixture.tgz").write_bytes(b"fixture tar")
            return subprocess.CompletedProcess(args, 0, json.dumps([{"filename": "fixture.tgz"}]), "")
        with patch.object(packager.subprocess, "run", side_effect=npm_pack):
            packager.package(self.root)
        timer = self.root / "releases/Activity-Timer-1.2.3.pbw"
        self.assertEqual(timer.read_bytes(), zip_bytes(self.pbw))
        sums = (self.root / "releases/SHA256SUMS.txt").read_bytes()
        selected = release.checksum_map(sums, ["dist.zip", "releases/fixture.tgz",
            "releases/Activity-Timer-1.2.3.pbw"], "releases/SHA256SUMS.txt")
        self.assertEqual(selected["releases/Activity-Timer-1.2.3.pbw"], release.digest(timer.read_bytes()))

    def test_unbuilt_timer_fails_before_touching_frozen_sdk(self):
        self.write("dist.zip", b"unchanged")
        with self.assertRaises(FileNotFoundError):
            packager.package(self.root)
        self.assertEqual((self.root / "dist.zip").read_bytes(), b"unchanged")


if __name__ == "__main__":
    unittest.main()
