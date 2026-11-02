#!/usr/bin/env python3
"""Bundle static CommonJS plugin code without a package-registry dependency.

Usage: bundle-js.py ENTRY OUTPUT. The pebble-activities package resolves to this
checkout; all other requests must be relative source files. No code is executed.
"""
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
REQUIRE = re.compile(r"\brequire\(\s*(['\"])([^'\"]+)\1\s*\)")


def bundle(entry):
    modules = []
    identifiers = {}

    def visit(path):
        path = path.resolve()
        if path in identifiers:
            return identifiers[path]
        if path.suffix != '.js' or not path.is_file():
            raise ValueError(f'JavaScript module is missing: {path}')
        index = len(modules)
        identifiers[path] = index
        modules.append(None)
        source = path.read_text(encoding='utf-8')

        def replace(match):
            request = match.group(2)
            if request == 'pebble-activities':
                target = ROOT / 'src/js/index.js'
            elif request.startswith('pebble-activities/'):
                target = ROOT / request[len('pebble-activities/'):]
            elif request.startswith('.'):
                target = path.parent / request
            else:
                raise ValueError(f'External module is unsupported in plugin: {request}')
            if target.suffix != '.js':
                target = target.with_suffix('.js')
            return f'require({visit(target)})'

        modules[index] = REQUIRE.sub(replace, source)
        return index

    main = visit(entry)
    wrappers = ',\n'.join('function(module,exports,require){\n' + source + '\n}' for source in modules)
    return ("'use strict';\n// Generated from pebble-activities sources; see bundled license.\n"
            "(function(modules){var cache={};function load(id){if(cache[id])return cache[id].exports;"
            "var module={exports:{}};cache[id]=module;modules[id](module,module.exports,load);return module.exports;}"
            f"load({main});}})([\n{wrappers}\n]);\n")


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    entry, output = Path(sys.argv[1]), Path(sys.argv[2])
    text = bundle(entry)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(text, encoding='utf-8')


if __name__ == '__main__':
    main()
