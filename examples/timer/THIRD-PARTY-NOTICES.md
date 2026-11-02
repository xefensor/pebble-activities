# Activity Timer third-party notices

Activity Timer and the bundled Pebble Activities helpers use the repository's
PolyForm Noncommercial License 1.0.0 and required Xef attribution, carried in
`LICENSE` in the packaged PBW.

The Pebble SDK injects `_pkjs_shared_additions.js` into the phone-side JavaScript
bundle. Its notice is preserved in that bundle:

> Copyright 2024 Google LLC

That SDK component is licensed under the Apache License, Version 2.0. The full
license is carried in `licenses/Apache-2.0.txt` in the PBW and source checkout.
The injected component is unmodified. It adds Pebble event aliases and error
reporting; it is supplied by the Pebble SDK rather than Pebble Activities.

The reference timer uses the watch's built-in fonts and has no bundled external
font, image or audio assets.
