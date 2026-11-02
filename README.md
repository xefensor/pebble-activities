# Pebble Activities

Shared publishing and consuming helpers for ongoing activities on **stock
PebbleOS**. A compatible provider can expose a timer, elapsed session or formatted
reading without adding a layout for that particular app to every watchface.

Version 0.1.0 is the first prerelease. The initial native target is Emery
(Pebble Time 2). Hardware and real-phone checks are recorded separately from
portable tests and emulator results in [validation](docs/VALIDATION.md).

Download the [Activity Timer PBW](https://github.com/xefensor/pebble-activities/releases/download/v0.1.0/Activity-Timer-0.1.0.pbw),
the [library package](https://github.com/xefensor/pebble-activities/releases/download/v0.1.0/pebble-activities-0.1.0.tgz),
or the [SDK package](https://github.com/xefensor/pebble-activities/releases/download/v0.1.0/dist.zip).
Verify downloads against [SHA256SUMS.txt](https://github.com/xefensor/pebble-activities/releases/download/v0.1.0/SHA256SUMS.txt).

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
| [Activity Timer](examples/timer/README.md) | A reference native timer, its PKJS bridge and its read-only plugin in one PBW |
| Optional compatibility adapter | Existing music/notification coordination, including privacy and notification baselines |

The package does not depend on Watchface Core. The host owns AppMessage dispatch,
SDK services, timers, persistence keys and rendering. Dynamic and another watchapp
can use separate instances of the same helpers while keeping their own UI.

## What the user installs

The library is bundled into each consuming app; it is not a separate watchapp or
background service. A provider plugin may ship alongside its native watchapp, as
the reference timer does, or in a plugin-only PBW. The phone app must support
Pebble plugins and have the preview enabled where that is required.

For the timer path, install the reference timer and a compatible consumer such as
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

- `createPublisher` accepts a versioned native snapshot, validates revisions,
  writes and reads back phone-side shared state, and returns an application receipt.
- `createProvider` exposes the saved state through an independently callable plugin.
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
host's existing lifecycle. The specification and reference timer document the
exact properties, receipt keys, session handshake and failure cases.

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

Build the timer after the library's `dist.zip` exists:

```sh
cd examples/timer
npm ci --ignore-scripts
npm test
python3 scripts/build.py
cd ../..
python3 scripts/package-release.py
```

The release script freezes the current SDK package and copies the latest packaged
reference timer into `releases/`; all three download assets receive checksums.
Release preparation verifies the timer's actual manifest, native identity and
integrity, bundled JavaScript and license against the committed inputs.

Consumers should pin the versioned `.tgz` and record its checksum. Updating this
repository does not silently update installed PBWs. Public release artifacts and
tags remain immutable; changed bytes require a new version.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE), with the required Xef attribution.
The compatibility adapter preserves attribution inherited from Watchface Core
and Halftone. Commercial use requires separate permission.

