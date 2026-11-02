#!/usr/bin/env python3
"""Run the local composition sweep; this does not test native Pebble rendering."""

import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
import subprocess
import tempfile


class Report(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inside = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "pre" and dict(attrs).get("id") == "study-report":
            self.inside = True

    def handle_endtag(self, tag):
        if tag == "pre":
            self.inside = False

    def handle_data(self, data):
        if self.inside:
            self.parts.append(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", default=shutil.which("chromium") or shutil.which("google-chrome"))
    parser.add_argument("--screenshot", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not args.browser:
        parser.error("Chromium or Google Chrome is required")
    page = Path(__file__).with_name("index.html").resolve().as_uri()
    with tempfile.TemporaryDirectory(prefix="pebble-presentation-browser-") as profile:
        command = [args.browser, "--headless", "--no-sandbox", "--disable-gpu",
                   "--disable-dev-shm-usage", "--disable-background-networking",
                   "--disable-component-update", "--disable-sync", "--disable-extensions",
                   "--no-first-run", "--no-default-browser-check", "--metrics-recording-only",
                   "--host-resolver-rules=MAP * ~NOTFOUND", "--window-size=1280,1100",
                   "--user-data-dir=" + profile, "--dump-dom"]
        if args.screenshot:
            command.append("--screenshot=" + str(args.screenshot.resolve()))
        command.append(page + "?case=printer&sweep=1")
        completed = subprocess.run(command, capture_output=True, text=True, timeout=45)
    if completed.returncode:
        raise SystemExit(completed.stderr or "Chromium failed")
    report_parser = Report()
    report_parser.feed(completed.stdout)
    report = json.loads("".join(report_parser.parts))
    if report.get("cases", 0) < 1 or "errors" not in report:
        raise SystemExit("Browser did not produce a complete sweep report")
    if args.output:
        args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
