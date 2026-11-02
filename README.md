# Pebble Activities

Shared publishing and consuming helpers for ongoing activities on **stock
PebbleOS**. A compatible provider can expose a timer, elapsed session or formatted
reading without adding a layout for that particular app to every watchface.

Version 0.2.0 adds bounded two-item activity cards and an opt-in ACT2 native view.
It retains schema 1/ACT1 compatibility. The initial native target is Emery
(Pebble Time 2). Hardware and real-phone checks are recorded separately from
portable tests and emulator results in [validation](docs/VALIDATION.md).

The 0.2.1 local candidate adds acknowledged completion visibility and an explicit
compact Timer projection. The published downloads below remain 0.2.0 until the
new candidate is published.

The current [GitHub development prerelease is 0.2.0](https://github.com/xefensor/pebble-activities/releases/tag/v0.2.0).
Download its [library package](https://github.com/xefensor/pebble-activities/releases/download/v0.2.0/pebble-activities-0.2.0.tgz)
or the [SDK package](https://github.com/xefensor/pebble-activities/releases/download/v0.2.0/dist.zip).
Verify downloads against [SHA256SUMS.txt](https://github.com/xefensor/pebble-activities/releases/download/v0.2.0/SHA256SUMS.txt).
The [published 0.1.2 release](https://github.com/xefensor/pebble-activities/releases/tag/v0.1.2)
remains available unchanged.
Install [Timer](https://github.com/xefensor/pebble-app-timer) separately to publish
native countdowns to a compatible watchface.

## Version 0.2.1

- Native publishers may explicitly hide an acknowledged completed result while
  preserving its completed lifecycle and revision tombstone. Visibility changes
  require a newer source revision.
- Providers may request `timerPresentation: 'compact'` for a countdown and one
  identity caption. The detailed Timer projection and generic supporting items
  remain available; configured duration stays in the saved source record.
- Existing schema 1/2 sources, ACT1/ACT2 packets, privacy and expiry rules remain
  compatible. Published 0.2.0 artifacts are preserved.

## Version 0.2.0

- Main and optional supporting text/value/clock, one 40px artwork slot and an
  optional range-derived meter in the same maximum 2,672-byte native frame.
- Independent item clocks, validity and explicit public last-reported retention;
  private content clears and terminal results require bounded source opt-in.
- Immutable authoritative source revisions are separate from native view
  sequences. Older source snapshots and terminal resurrection remain invalid.
- `activity/card` schema 2 and `nativeFormat: 2` are opt-in. Legacy providers,
  consumers, native publishers and stable multi-timer storage remain supported.
- Timer's optional configured-duration metadata produces remaining and elapsed
  clocks without changing native persistence or alarm ownership.

See the [card and native view specification](docs/VIEW-SPECIFICATION.md).

## Version 0.1.2

- Publishers may opt into up to eight stable host-owned slots, with independent
  timer runs exposed through the existing multi-instance source convention.
- A new run atomically replaces the prior run in its slot, including after an
  offline restart; unrelated timers are preserved.
- Existing single-record storage migrates to slot zero without changing its
  namespace. Default single-record publisher behavior remains compatible.
- Receipts still require write/readback, a source-wide revision floor and exact
  run/revision/ticket matching. Public source properties and ACT1 are unchanged.

## Version 0.1.1

- Timer now lives in its own [repository](https://github.com/xefensor/pebble-app-timer),
  with its own builds, releases and bundled provider plugin.
- Library packaging and checks no longer require a Timer checkout or PBW.
- The activity protocol and library runtime remain compatible with 0.1.0.
- Historical 0.1.0 artifacts remain available unchanged; app and library versions
  now advance independently.

## Version 0.1.0

- Independent versioned source convention and ACT1 native transport.
- Stock timer publishing, accepted-revision receipts and cold plugin reads.
- Automatic compatible-provider discovery with bounded native projections.
- Countdown and elapsed clocks, expiry and explicit unconfirmed public timer state.
- Optional music/notification compatibility adapter with preserved privacy gates.

## Package contents

| Part | Responsibility |
| --- | --- |
| [Public convention](docs/SPECIFICATION.md) | Versioned `activity/session` source properties using existing Pebble shapes |
| JavaScript publisher and provider | Accept native snapshots into shared phone-side storage, return revision receipts, and answer plugin reads |
| JavaScript consumer | Discover compatible providers, normalize their state and send a bounded projection through the host's queue |
| Portable C helpers | Validate atomic packets, track sessions and expiry, and calculate countdown or elapsed time |
| Optional compatibility adapter | Existing music/notification coordination, including privacy and notification baselines |

The package does not depend on Watchface Core. The host owns AppMessage dispatch,
SDK services, timers, persistence keys and rendering. Dynamic and another watchapp
can use separate instances of the same helpers while keeping their own UI.

## What the user installs

The library is bundled into each consuming app; it is not a separate watchapp or
background service. A provider plugin may ship alongside its native watchapp, as
[Timer](https://github.com/xefensor/pebble-app-timer) does, or in a plugin-only PBW. The phone app must support
Pebble plugins and have the preview enabled where that is required.

For the timer path, install Timer and a compatible consumer such as
Dynamic. Start a timer on the watch, then return to the watchface. The timer sends
its state through its own PKJS; its plugin later serves the saved snapshot to the
consumer. This is a phone-mediated handoff between otherwise separate apps.

The timer owns its alarm even when sharing fails. Without a phone connection, a
consumer may have no activity or an explicitly unconfirmed earlier countdown.
Reaching zero locally does not prove that the originating app completed or rang.

## Developer entry points

```js
var activities = require('pebble-activities');
```

- `createPublisher` accepts a versioned native snapshot and an optional stable slot, validates revisions,
  writes and reads back phone-side shared state, and returns an application receipt.
- `createProvider` exposes the saved state through an independently callable plugin.
  Its optional `timerPresentation: 'compact'` projects Timer as a countdown and
  one identity caption, while the default `'detailed'` preserves derived elapsed
  support. Both preserve original observations and acknowledged terminal
  visibility; see the [projection contract](docs/VIEW-SPECIFICATION.md#native-timer-compatibility).
- `createActivities` discovers compatible providers and supplies a bounded native
  projection. Inject Pebble, message keys, the shared send queue, clock and timers.
- `wire` defines the independent ACT1 transport. It does not reinterpret Core's
  legacy complication/context packets.
- `createContext` is the optional compatibility adapter for standard music and
  notification sources. It is separate from the generic source convention.

Native consumers include:

```c
#include <pebble-activities/pebble-activities.h>
```

The decoder and state functions register no SDK services. Call them from the
host's existing lifecycle. The specification and the standalone Timer repository document the
exact properties, receipt keys, session handshake and failure cases.

### Presentation across apps

The [use-case and architecture review](docs/USE-CASE-REVIEW.md) compares the
supported summary against a proposed bounded main-plus-supporting-item view.
It covers source/view revisions, retention, result visibility and measured ARM
storage, while keeping layouts owned by consumers. Any compatible activity may
occupy either Dynamic position. The [native design](docs/NATIVE-ACTIVITY-DESIGN.md)
documents compatibility and correctness work for the current path. These are
designs; [specification version 1](docs/SPECIFICATION.md) remains the implemented
contract. The earlier [browser study](docs/presentation-study/README.md) remains
an exploration.

### Multiple native timers

A provider that owns several independent records uses
`createPublisher({storage: localStorage, pluginUuid: UUID, maxRecords: 8})`.
Include `ACTIVITY_SLOT` (0–7) in each native snapshot, or `slot` when calling
`accept` directly. The host owns those stable slots; run IDs remain the public
identity. A new run replaces only the previous run in the same slot. Missing
slot means zero, preserving the original single-record path.

Each accepted update advances a **source-wide** revision, even when updating
another slot. A native resync obtains `lastRevision()` and republishes its slots
with distinct higher revisions. The read-only provider loads all slots without
an extra option. A consumer may still project only its best two activities to
the watch; the host chooses that presentation policy.

## Boundaries

- This convention is our public contract, not an official Pebble activity standard.
- Existing timer and workout apps need an explicit integration; discovery cannot
  access another watchapp's private memory or storage.
- The built-in Workout app's live manual session is not exposed by the current
  public SDK. This stock implementation does not claim to provide that session.
- Fully watch-local sharing and Health-style cross-app compositor transitions
  require additional OS support. No firmware or phone-app fork is used here.
- Private music and notification content is transient and is not persisted by
  these consumer helpers. The reference publisher is a bounded, non-private timer
  handoff, not a persistent cache for private messages or medical readings.

## Build and check

Use Node.js, Python 3, a C99 compiler and an official Pebble SDK with Emery support.

```sh
npm ci --ignore-scripts
npm test
pebble build
```

Package the built library and check the release helpers:

```sh
python3 -m unittest discover -s tests -p 'test_*release.py'
python3 scripts/package-release.py
```

The release script freezes the current SDK package and writes the versioned npm
package into `releases/`; both download assets receive checksums. Timer is built
and released from [its own repository](https://github.com/xefensor/pebble-app-timer).
A library release does not require a Timer build, and installed apps retain their
pinned library version until rebuilt.

Consumers should pin the versioned `.tgz` and record its checksum. Updating this
repository does not silently update installed PBWs. Public release artifacts and
tags remain immutable; changed bytes require a new version.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE), with the required Xef attribution.
The compatibility adapter preserves attribution inherited from Watchface Core
and Halftone. Commercial use requires separate permission.

