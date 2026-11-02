# Pebble Activities specification version 1

This is the public convention implemented by pebble-activities 0.1.0. It is a
project convention over Pebble's existing plugin API, not an official Pebble
category or a new plugin shape. Compatible providers can be discovered without
adding provider-specific code to each consuming watchface or watchapp.

## Source declaration

Declare category `activity`, item `session`, and the properties below in the
plugin manifest. Set `supportsMultiple: true` if several runs may be returned.
A consumer enumerates compatible plugins and subscribes separately to each
selected provider UUID. An unqualified category/item subscription returns only
one preferred provider; it does not aggregate the installed providers.

```json
{
  "category": "activity",
  "items": ["session"],
  "properties": {
    "schema_version": ["numericValue"],
    "revision": ["numericValue"],
    "kind": ["shortText"],
    "state": ["shortText"],
    "clock": ["shortText"],
    "name": ["longText"],
    "main": ["longText"],
    "footer": ["longText"],
    "observed_at": ["timestamp"],
    "valid_until": ["timestamp"],
    "deadline": ["timestamp"],
    "duration": ["numericValue"],
    "clock_at": ["timestamp"],
    "private": ["boolean"],
    "unconfirmed": ["boolean"],
    "value": ["numericValue"],
    "artwork": ["image", "icon"]
  },
  "supportsMultiple": true,
  "suggestedRefreshIntervalSec": 5
}
```

Return standard Pebble envelopes containing `instances`. Each instance identifies
one particular run through its `instanceId`; it is not merely a reusable timer
name. Identity is the provider UUID, category/item and run ID together. UUIDs
are canonical lowercase hexadecimal. Run IDs are nonempty and at most 64 UTF-8
bytes. A restarted timer gets a new run ID. Revisions are integers from 1 through
4294967295 and increase whenever that run's authoritative state or display properties change. A revision is immutable (apart from the unconfirmed availability/provenance annotation): a repeated identical snapshot may refresh source availability, but conflicting content at the same revision is invalid, including an attempt to undo a terminal tombstone.

The host supplies `pluginUuid` on the delivered envelope. A pinned subscription
can fall back if the requested provider disappears. Consumers must verify the
returned UUID and must not accept a different provider's snapshot in its place.

| Property | Meaning |
| --- | --- |
| `schema_version` | `numericValue.value` must be 1 |
| `revision` | Integer revision of the run |
| `kind` | Short semantic code such as timer, workout, glucose or music; not a layout definition |
| `state` | `active`, `paused`, `completed` or `cancelled` |
| `clock` | `none`, `deadline` or `elapsed` |
| `main` | Main display text, at most 192 UTF-8 bytes after normalization |
| `footer` | Supporting text, at most 128 UTF-8 bytes; `name` is its fallback |
| `observed_at` | Authoritative observation timestamp, UTC epoch seconds |
| `valid_until` | Original per-instance validity limit, UTC epoch seconds |
| `deadline` | Expected zero time for an active countdown, UTC epoch seconds |
| `duration` | Fixed remaining seconds for a paused countdown, or accumulated active seconds for an elapsed clock; `numericValue.unit` is `s` |
| `clock_at` | Observation/anchor timestamp corresponding to an active elapsed duration |
| `unconfirmed` | True for a last-reported/estimated state that has not been confirmed currently by its authoritative source |
| `private` | Defaults to true; an explicit false permits retaining a last-reported clock after disconnection |
| `value` | Optional finite `numericValue` and unit; keep the provider's formatted main text when supplied |
| `artwork` | Optional standard image/icon, generated only when requested; maximum 40 by 40 pixels |

Unknown schema versions and malformed required fields are unavailable. Missing,
withdrawn, redacted or denied content retracts the previous activity. A source
update is a complete current list, not a patch. Terminal `completed` and
`cancelled` records retract their run. A terminal run cannot become active again; use a new run ID for a restart. Retain such tombstones for a bounded
period so obsolete queued active records cannot resurrect it.

## Clock semantics

An active deadline clock supplies a nonzero `deadline`, with `duration` and
`clock_at` zero or absent. A paused deadline clock has a zero/absent deadline
and anchor, and a fixed `duration`. An active elapsed clock supplies the active
seconds accumulated at `clock_at`; the consumer adds time since that anchor. A
paused elapsed clock has a fixed `duration` and zero/absent anchor. A clock of
`none`, and every terminal record, has all clock fields zero or absent.

The consumer can calculate a clock locally. It must not invent updated sensor
measurements, a completed source state, or an alarm-rang event. A countdown
reaching zero means due/unconfirmed until the source reports completion.
Backward wall-clock movement does not subtract from the accumulated elapsed
base. A new authoritative snapshot corrects the displayed clock.

`validUntilMs` on the outer envelope is in milliseconds and describes source
availability. Per-instance `observed_at` and `valid_until` are in seconds. Polling
saved data can renew source availability, but never its native observation or
per-run validity. A public last-reported clock can remain visible as explicitly
unconfirmed after source availability expires, up to its original validity.
Private and non-clock readings clear instead. A fresh source envelope cannot clear an explicit unconfirmed marker on cached native state. Permission denial, source
withdrawal and provider removal always retract content, including public clocks.
Music and notification kinds are always private; a consumer also applies its
own source/preview policy. Generic notifications do not automatically gain the
baseline or alert semantics of the mature built-in notification adapter.

## Consumer helpers

```js
var activities = require('pebble-activities').createActivities({
  pebble: Pebble,
  keys: messageKeys,
  send: sharedMessageQueue,
  now: Date.now,
  later: setTimeout,
  cancelLater: clearTimeout,
  getSettings: function () { return { enabled: true }; }
});
```

The factory registers no global Pebble event handlers. The host forwards its
lifecycle and owns a single AppMessage queue/dispatcher. `refresh(true, token)`
sets a new native session and rediscovers providers; `refresh()` without a token
sends a `REQUEST_ACTIVITIES=1` bootstrap query. The native host must answer with
its current unique session token, which is an integer from 2 through 4294967295.
A new launch, reconnect or PKJS-runtime boundary must not reuse stale private
state. `connectionChanged(connected, token)`, `configure()`, `status()`,
`catalogue()` and `stop()` complete the API.

`getSettings()` accepts `enabled` (default true), optional `providers` UUID
allowlist and optional `disabledProviders`. `acceptActivity(card)` can enforce
host policies such as a music opt-out. `select(catalogue)` can choose at most two
cards for this consumer's native budget. The default projection is stable
first-seen order. The full phone catalogue and the native two-card projection
are distinct; this is not a universal two-activity limit for every UI.

Status reports provider identity and availability/error codes, never activity
text. Generic activity content is transient and is not persisted or logged by
the consumer. Discovery is restricted to the compatible activity convention;
it must not subscribe indiscriminately to unrelated sources with side effects.

## Native publisher and phone handoff

The separate [Timer app](https://github.com/xefensor/pebble-app-timer) bundles its native watchapp, PKJS and provider plugin into
one PBW. PKJS and that same PBW's plugin use the same UUID-scoped phone storage.
This does not create shared native storage between separate watchapps.

The native app owns authoritative state and alarm scheduling. It persists its
state and publishes promptly while foreground, with the latest pending
snapshots serialized behind an active AppMessage transfer. PKJS uses:

```js
var bridge = require('pebble-activities/publisher').createPublisher({
  storage: localStorage,
  pluginUuid: TIMER_UUID,
  private: false
});
var receipt = bridge.handleMessage(event.payload);
// Send a non-null receipt using the host's serialized Pebble.sendAppMessage.
```

The dictionary names are `ACTIVITY_SCHEMA_VERSION`, `ACTIVITY_RUN`,
`ACTIVITY_REVISION`, `ACTIVITY_STATE`, `ACTIVITY_KIND`, `ACTIVITY_CLOCK`,
`ACTIVITY_NAME`, `ACTIVITY_MAIN`, `ACTIVITY_FOOTER`, `ACTIVITY_OBSERVED_AT`,
`ACTIVITY_VALID_UNTIL`, `ACTIVITY_DEADLINE`, `ACTIVITY_DURATION`,
`ACTIVITY_CLOCK_AT`, and optional `ACTIVITY_PRIVATE` and `ACTIVITY_SLOT`. States `running` and
`finished` are accepted native-dictionary aliases for active and completed.
The source and wire convention always use the canonical names.

After writing and reading back one versioned snapshot, the bridge returns
`ACTIVITY_ACCEPTED_RUN` and `ACTIVITY_ACCEPTED_REVISION`. If the sender includes
`ACTIVITY_PUBLISH_SESSION`, a nonzero uint32 publication ticket, it is echoed
unchanged. The native publisher must match run, revision and ticket against
both the current model and its in-flight transfer before accepting that receipt.
A changed model, retry generation or reconnection invalidates old receipts.
Errors return a content-free `ACTIVITY_ERROR` code. The receipt means accepted
into shared phone-side state; it is not proof of disk flush, delivery to another
watchapp or an alarm firing. An AppMessage transport ACK alone is insufficient.

The helper defaults to one record. Setting `maxRecords` to an integer from 1
through 8 enables bounded stable host-owned slots. `ACTIVITY_SLOT` is an integer
from zero through `maxRecords - 1`; `accept(snapshot)` reads the same value from
`snapshot.slot`. An omitted slot means zero. Invalid limits throw
`INVALID_RECORD_LIMIT`; an invalid slot returns `INVALID_SLOT` without saving or
acknowledging it. Slot numbers are bridge metadata, not public source properties
or part of ACT1.
Opening a publisher with a smaller limit while higher occupied slots remain
returns `RECORD_LIMIT_CONFLICT` without writing or acknowledging the snapshot.
Use the established limit to update or retract those slots first.

Each slot owns its latest run. A newer run ID atomically replaces that slot's
previous run, even if an offline cancellation was not shared first. It does not
evict another slot's active timer. A run ID cannot occupy two slots
(`SLOT_CONFLICT`). A terminal run cannot become active again with the same ID;
restarting requires a new run ID. Existing `{schemaVersion: 1, revision, card}`
storage is read as slot zero at the same key. Opt-in collection writes use
`{schemaVersion: 1, revision, slots: [...]}`, with at most eight normalized cards
or null entries. Default one-record writes retain the legacy envelope.

A **source-wide** monotonic revision is required across all slots and successive
runs. `bridge.lastRevision()` returns the saved floor, including expired state.
At native-source startup, PKJS supplies that floor in its state-resync request.
The authoritative native owner advances above both local and phone floors and
publishes its records sequentially with distinct revisions. Only an identical
repeat of the latest stored run/revision can be acknowledged at the same global
revision. A reinstalled/reset native app can therefore recover while an older
run still in flight cannot overwrite a newer slot snapshot.

This publisher helper refuses private persistent snapshots. A private retraction
clears that slot's previous public contents and retains only the source-wide
numeric revision floor; it saves neither the private identity nor body. Other
public slots remain available. With the default single record this removes all
prior public contents, as before. Music and notification metadata must not be
passed through it. The plugin side is
read-only, with no native timer-control action hidden in storage writes:

```js
var provider = require('pebble-activities/publisher').createProvider({
  storage: localStorage,
  pluginUuid: TIMER_UUID
});
Pebble.registerSourceHandler(provider.handleSource);
```

A source call cold-starts and reads all nonexpired saved slots in numeric slot order. The reference provider always marks saved native snapshots as `unconfirmed`, including after reconnect: it has no way to prove that an offline pause or cancellation in the closed timer app reached the phone. Current plugin availability is not current native state. A new native snapshot updates the last-reported revision, but the cached view remains identified as last-reported. No forever-running plugin
or timer PKJS session is assumed. The native timer must continue working and
alerting without the phone. Back remains usable while sharing is pending. If
an offline native change cannot reach PKJS before the app closes, another app
cannot know that change through this bridge; show no state or a last-reported,
unconfirmed clock until authoritative resync.

## ACT1 native wire format

This independent format does not reinterpret Core's legacy V4 context packets.
All integers are unsigned little-endian. Numeric values are finite IEEE754
binary64 little-endian. Times are UTC epoch seconds. A snapshot contains at most
two complete records and is at most 2672 bytes before AppMessage dictionary
overhead. The recommended host inbox is at least 6144 bytes when Core and
activities share the same dispatcher.

| Header offset | Length | Meaning |
| --- | --- | --- |
| 0 | 4 | ASCII `ACT1` |
| 4 | 1 | Version 1 |
| 5 | 1 | Record count 0 through 2 |
| 6 | 2 | Complete packet byte length |
| 8 | 2 | CRC16 CCITT with seed 65535 and polynomial 0x1021; skip bytes 8 and 9 |
| 10 | 2 | Reserved, zero |
| 12 | 4 | Native session token |
| 16 | 4 | Monotonic snapshot revision within that session |
| 20 | 4 | Phone send time, not a source observation timestamp |

Each record has a 48-byte header followed by its UTF-8 strings in the order
provider UUID, run ID, kind, main, footer, unit, then optional image data.

| Record offset | Length | Meaning |
| --- | --- | --- |
| 0 | 1 | State: active 1, paused 2, completed 3, cancelled 4 |
| 1 | 1 | Clock: none 0, deadline 1, elapsed 2 |
| 2 | 1 | Flags: private 1, image 2, numeric 4, unconfirmed 8 |
| 3 | 1 | Reserved, zero |
| 4 | 4 | Per-run revision |
| 8 | 4 | Authoritative observed time |
| 12 | 4 | Original per-instance validity |
| 16 | 4 | Deadline, otherwise zero |
| 20 | 4 | Fixed remaining / accumulated active seconds |
| 24 | 4 | Elapsed clock anchor, otherwise zero |
| 28 | 8 | Finite numeric value, or all-zero bytes when absent |
| 36 | 6 | Byte lengths of provider, run, kind, main, footer, unit |
| 42 | 1 | Image width, zero when absent |
| 43 | 1 | Image height, zero when absent |
| 44 | 2 | Image pixel-byte length, zero when absent |
| 46 | 2 | Reserved, zero |

Image data is a 16-byte palette followed by tightly packed 4bpp rows with
stride `ceil(width/2)` and a maximum 800 pixel bytes. An odd-width row's unused
low nibble is zero. Missing/invalid enums, clocks, lengths, UTF-8, image bounds,
reserved bits, nonfinite numbers, duplicate provider/run pairs, CRC or session
mismatches are rejected. Private and unconfirmed flags cannot coexist. An
active or paused record needs main text, a numeric value, or a clock.

The native decoder validates the whole frame before replacing state. A malformed
current-session frame clears transient state; stale sessions/revisions cannot
replace a newer accepted frame. Consumers do not persist this private state.
An outgoing animation snapshot cannot outlive redaction or expiry.

## Legacy built-in adapters

`createContext(options)` is the separately bundled migration adapter for the
existing music, notifications and low-phone-battery sources. Its API and V4
packet/baseline/privacy semantics are preserved from Watchface Core 0.4.1,
including bounded notification bursts, history baselines and immediate
redaction. It has no runtime dependency on Core. Hosts may keep the legacy
channel during migration while receiving generic ACT1 activities separately.
This adapter is not a promise that arbitrary notification providers can bypass
user preview preferences or native notification behaviour.

## Scope on stock firmware

The reference timer's alarm is native, while cross-app sharing uses the phone.
There is no added OS service, firmware fork or custom mobile app. The built-in
Workout app's live manual session is not exposed by the current public SDK and
is not advertised as supported. A compatible external provider may publish
elapsed workout state if it actually owns background tracking and updates.
