#!/usr/bin/env python3
"""Freeze the built SDK and reference timer as versioned release artifacts."""
from pathlib import Path
import hashlib
import io
import json
import subprocess
import tempfile
import zipfile


def package(root):
    pkg = json.loads((root / 'package.json').read_text())
    timer = json.loads((root / 'examples/timer/package.json').read_text())
    if timer['version'] != pkg['version']:
        raise ValueError('Reference timer and library versions differ')
    timer_name = 'Activity-Timer-' + timer['version'] + '.pbw'
    timer_source = root / 'examples/timer/dist' / timer_name
    # Fail before modifying frozen artifacts when the example was not built.
    timer_bytes = timer_source.read_bytes()
    with zipfile.ZipFile(io.BytesIO(timer_bytes)) as archive:
        if archive.testzip() is not None:
            raise ValueError('Corrupt reference timer PBW')
        info = json.loads(archive.read('appinfo.json'))
        if (info.get('uuid') != timer['pebble']['uuid'] or
                info.get('versionLabel') != timer['version']):
            raise ValueError('Reference timer PBW identity/version differs')
    sdk = root / 'dist.zip'
    with zipfile.ZipFile(sdk) as archive:
        if archive.testzip() is not None:
            raise ValueError('Corrupt SDK package')
        files = {name: archive.read(name) for name in archive.namelist()}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data, compresslevel=9)
    sdk.write_bytes(buffer.getvalue())
    releases = root / 'releases'
    releases.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pebble-activities-pack-') as tmp:
        result = subprocess.run(['npm', 'pack', '--pack-destination', tmp, '--json'],
            cwd=root, check=True, capture_output=True, text=True)
        metadata = json.loads(result.stdout)[0]
        artifact = Path(tmp) / metadata['filename']
        target = releases / artifact.name
        target.write_bytes(artifact.read_bytes())
    timer_target = releases / timer_name
    timer_target.write_bytes(timer_bytes)
    checksums = []
    for path in (sdk, target, timer_target):
        checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        checksums.append(checksum + '  ' + str(path.relative_to(root)))
        print(str(path.relative_to(root)), path.stat().st_size, checksum)
    (releases / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n')


if __name__ == '__main__':
    package(Path(__file__).resolve().parents[1])
