# Pebble Activities

Semantic ongoing activities for **stock PebbleOS**. Version **0.4.0** adds
`activity/summary` schema4: standard summaries with typed headline/detail data,
and media summaries with title/artist/artwork. Plugins publish content; consuming
apps own priority, normal/compact layouts and animations.

Use `require('pebble-activities/summary')` for new providers and `nativeFormat:3`
for the explicit ACT3 profile. Managed fresh providers persist only publication
counters; snapshot providers preserve native ownership and original leases.
Optional app destinations remain separate from contextual controls.

See the [summary specification](docs/SUMMARY-SPECIFICATION.md) for the implemented
API and exact wire fields. Schema1/2/3 and ACT1/ACT2 remain compatible. The older
schema3 example below remains supported. Dynamic, Timer and Open Activity have
their own integration/device validation; no Dashboard app is included.

## Publish an activity

```js
var activity = require('pebble-activities').activity;
var current = [];

// Called for an actual source update, not every provider poll. The source owns
// stable run IDs, revisions and the original observation/expiry of its data.
function onTimerChanged(timer) {
  current = [{
    id: timer.runId,
    revision: timer.revision,
    observedAt: timer.observedAt,
    validUntil: timer.validUntil,
    state: timer.state,
    kind: 'timer',
    private: false,
    content: timer.state === 'active'
      ? activity.countdown({deadline: timer.deadline})
      : activity.countdown({seconds: timer.remaining})
  }];
}

var provider = activity.createProvider({
  pluginUuid: OWN_PLUGIN_UUID,
  appName: 'Timer',
  getActivities: function() { return current; }
});
Pebble.registerSourceHandler(provider.handleSource);
```

Declare `activity/live` with `activity.SOURCE_PROPERTIES` in the plugin manifest.
The provider serves a snapshot without renewing its source observation. The
native Timer bridge has a separate adapter described below; this example shows
a plugin that owns its live source data.

A text activity simply uses `content: 'Arriving at your door'`. A measurement
uses `content: activity.value(6.2, 'mmol/L')`. Add `detail: 'Platform 3'` or a
clock helper when a second piece of information is useful. Labels are optional
and reserved for meaning such as `activity.countdown({deadline: end, label: 'Rest'})`.
The app identity and image stay separate from content. Any kind of activity can
occupy either host role; normal and compact are presentations of the same data.

See the [simple activity specification](docs/ACTIVITY-SPECIFICATION.md) for
helpers, source declarations, privacy and migration. Real-phone and physical
watch checks are recorded separately from portable/emulator results in
[validation](docs/VALIDATION.md).

## Version 0.4.0 local candidate

- Add standard/media semantic source4 helpers and managed response headers.
- Preserve saved Timer revisions, original observations, paused caps and acknowledged removal.
- Add bounded ACT3 metadata for media identity, compact datum selection and semantic symbols.
- Keep optional entity/action/navigation descriptors separately bounded.
- Preserve earlier APIs, published tags and release bytes.

## Download

The published development prerelease remains0.3.0;0.4.0 is a local candidate.

The current [GitHub development prerelease is 0.3.0](https://github.com/xefensor/pebble-activities/releases/tag/v0.3.0).
Download its [library package](https://github.com/xefensor/pebble-activities/releases/download/v0.3.0/pebble-activities-0.3.0.tgz)
or [SDK package](https://github.com/xefensor/pebble-activities/releases/download/v0.3.0/dist.zip),
and verify [SHA256SUMS.txt](https://github.com/xefensor/pebble-activities/releases/download/v0.3.0/SHA256SUMS.txt).
[Earlier releases](https://github.com/xefensor/pebble-activities/releases) retain
their original tags and bytes. Install [Timer](https://github.com/xefensor/pebble-app-timer)
separately to publish native countdowns.

## Version 0.3.0

- Introduce notification-style `activity/live` schema 3: content, optional detail
  and image, with app identity and authoritative source lifecycle metadata.
- Provide text, value, countdown and elapsed helpers without mandatory visible
  labels, meter definitions, field trees or host-specific layout choices.
- Prefer simple sources during discovery and validate their immutable revisions
  before compiling the existing bounded ACT2 packet. Existing session/card
  providers and native packet formats remain supported.
- Adapt native Timer publishing and transient Music through the same model;
  retain original observations, acknowledgement tombstones, privacy and expiry.
- Keep normal/compact composition, provider priority and settings owned by hosts.
  Published 0.2.2 and earlier assets remain unchanged.

## Version 0.2.2

- Expose compatible installed provider identities even while idle, with display
  metadata kept outside authoritative source fingerprints.
- Share a pure provider-order selector. Hosts own their settings and storage;
  the library does not install a settings service or impose a global order.
- Offer an opt-in canonical music card from the existing adapter. Music stays
  transient, uses the SDK source UUID, retains observation and expiry, and clears
  when disconnected or disabled. Polling never renews its source observation.
- Preserve default adapter behavior, ACT1/ACT2 layouts, source revision rules,
  notification privacy and existing provider compatibility.

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
| [Simple activity API](docs/ACTIVITY-SPECIFICATION.md) | Content, optional detail/image, app identity and lifecycle through `activity/live` schema 3 |
| Compatibility contracts | Advanced schema 2 and legacy schema 1 remain supported; ACT2 native transport stays internal |
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

## Host and native integration

Use `createActivities({..., nativeFormat: 2})` with the host’s existing queue,
clock and SDK lifecycle. Discovery prefers `activity/live`, then the advanced
`activity/card`, then legacy `activity/session`, once per compatible provider.
`catalogue()` supplies validated internal views to host selection; plugins never
choose Dynamic’s priority or layout. Another host can keep its own order and UI.

`activity.toView()` compiles a simple record into the existing ACT2 transport.
The native packet is unchanged. Its mandatory field bookkeeping stays internal;
public activities contain no `main`, `support`, `meter` or layout properties.
The [simple source contract](docs/ACTIVITY-SPECIFICATION.md) is the current
plugin authoring guide. [Schema 2 and ACT2](docs/VIEW-SPECIFICATION.md) and
[schema 1/ACT1](docs/SPECIFICATION.md) remain supported compatibility contracts.
Historical architecture/browser studies describe earlier design decisions and
do not add requirements to the simple API.

For native watchapps, `createPublisher` still accepts authoritative bridge
snapshots, validates revision floors and writes/reads back public shared state
before issuing receipts. `createProvider({presentation: 'simple', appName: 'Timer',
...})` exposes those saved snapshots as `activity/live`; existing session/card
sources remain available. No alarm, native storage or receipt ownership moves
to the consuming watchface.

`createContext` adapts standard Music and notification sources with their
existing privacy/baseline rules. Its transient Music activity now uses the
same simple model, without fabricated Track/Artist labels or a missing-artist
placeholder. Notifications retain their separate bounded interruption policy.
Native consumers include `pebble-activity-view.h`; these helpers register no SDK
services and allocate no host UI. See the specification for exact failure rules.

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

