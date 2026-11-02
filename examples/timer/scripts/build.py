#!/usr/bin/env python3
"""Build the stock SDK timer and include its independently callable plugin."""
from pathlib import Path
import hashlib
import json
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
library = root.parents[1]
package = json.loads((root / "package.json").read_text())
build = root / "build"
build.mkdir(exist_ok=True)
subprocess.run([
    "python3", str(library / "scripts/bundle-js.py"),
    str(root / "src/plugin/index.js"), str(build / "plugin.js")
], check=True, cwd=root)
subprocess.run(["pebble", "build"], check=True, cwd=root)
# The stock SDK names the development bundle after the project directory.
pbw = build / (root.name + ".pbw")
with zipfile.ZipFile(pbw) as source:
    entries = {name: source.read(name) for name in source.namelist()}
appinfo = json.loads(entries["appinfo.json"])
appinfo["manifestVersion"] = 2
appinfo["usesPermissions"] = package["pebble"]["usesPermissions"]
appinfo["plugin"] = package["pebble"]["plugin"]
entries["appinfo.json"] = json.dumps(appinfo, indent=2).encode()
entries["plugin.js"] = (build / "plugin.js").read_bytes()
entries["LICENSE"] = (library / "LICENSE").read_bytes()
entries["THIRD-PARTY-NOTICES.md"] = (root / "THIRD-PARTY-NOTICES.md").read_bytes()
entries["licenses/Apache-2.0.txt"] = (root / "licenses/Apache-2.0.txt").read_bytes()
destination = root / "dist" / ("Activity-Timer-" + package["version"] + ".pbw")
destination.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as output:
    for name, content in sorted(entries.items()):
        entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o644 << 16
        output.writestr(entry, content)
checksum = hashlib.sha256(destination.read_bytes()).hexdigest()
(destination.parent / "SHA256SUMS.txt").write_text(checksum + "  " + destination.name + "\n")
print(destination)
