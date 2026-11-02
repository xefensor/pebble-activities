# Activity cards and ACT2 version 2

Implemented by the unpublished Activities 0.2.0 candidate. This extends the
project convention on stock PebbleOS; it is not an official platform standard.
The [schema 1 and ACT1 APIs](SPECIFICATION.md) remain available for existing
providers and consumers. Consumers explicitly opt into `nativeFormat: 2`.

## Source ownership and presentation

One activity has a provider/run identity, an immutable source revision,
authoritative lifecycle, original observation and validity, a caption, one main
item and an optional supporting item. Each item is text, a value or a clock.
Artwork and a meter are optional. The supporting item belongs to that activity;
a second activity remains a different identity.

The source owns data and operations. A host chooses typography, fitting and
which records appear. Newer native view sequences may change presentation while
preserving a source revision. Conflicting source snapshots at that revision,
source rollback and resurrection of terminal runs remain invalid.

The phone validates source truth before projection. Native revision checks cover
resident records; catalogue-wide revision/tombstone checks remain on the phone.
The watch never receives a general field tree or a whole provider catalogue.

## JavaScript authoring and consumption

```js
var activities = require('pebble-activities');
var card = activities.view.createCard({
  provider: OWN_PLUGIN_UUID, id: 'run-42', kind: 'workout', revision: 7,
  state: 'active', observedAt: observed, validUntil: expires,
  private: false, caption: 'Interval run',
  main: {type: 'clock', label: 'Rest', mode: 'deadline', running: true,
         baseSeconds: 80, anchorAt: observed},
  support: {type: 'clock', label: 'Elapsed', mode: 'elapsed', running: true,
            baseSeconds: 1458, anchorAt: observed}
});
```

`createCard`/`normalize` returns a canonical card or `null`. No global SDK handlers
are registered. Use `view.toSourceInstance(card, request)` inside the provider's
own handler. `view.SOURCE_PROPERTIES` supplies the manifest property declaration.
Declare category `activity`, item `card`, schema version 2 and `supportsMultiple`
where appropriate. Keep a separate `session` source for legacy consumers.

A v2 consumer is created with the existing host-injected options and
`nativeFormat: 2`. It prefers a compatible provider's `card` item, otherwise
adapts `session` version 1. It never subscribes twice merely to show both forms.
`catalogue()` and `select()` receive canonical main/support objects for v2.
`reproject()` republishes a host selection without rebinding providers. The
default consumer still uses schema 1 and ACT1.

The helpers are independent of Dynamic. Its phone host keeps its own selection
policy; another app can use a different bounded selection and native layout.

## Item and lifecycle rules

An item supplies `type`, a nonempty `label`, observation/validity (defaulting to
the source times), `retain` and `estimated` booleans. Text supplies `text`.
Values supply either formatted text or a finite numeric `value` and optional
`unit`; numeric text is derived from that same value. A contradictory supplied
text/value pair is invalid. Units stay in the projected text.

Clocks supply `mode: deadline|elapsed`, `running`, `baseSeconds` and `anchorAt`.
For a running clock, delta is `max(0, now - anchorAt)` and the value is
`max(0, baseSeconds - delta)` for countdown or a saturated `baseSeconds + delta`
for elapsed. A paused clock has anchor zero and a fixed base. Running state is
per item; the activity's global paused state does not freeze an unrelated clock.
Backwards wall time never subtracts from the recorded elapsed base.

Each item retains its actual observation and expiry. Neither can exceed the
source's time bounds. An expired supporting item disappears independently;
an expired/unavailable main item hides the card. No silent metric promotion occurs.

Privacy defaults to private. Music and notifications remain private. Private
content cannot be cached/unconfirmed. Public unavailable data can remain only
with that item's explicit `retain`, original validity and visible provenance.
Permission to show last-reported data does not authorize persistent history.

Countdown zero means due/uncertain, not source completion. Completed/cancelled
runs remain terminal. They display only if the source explicitly sets
`showTerminal`, and only until original validity. A result's age does not restart
the activity. Native Timer opts into a brief completed result; cancellation
still retracts it.

A meter supplies `kind: progress|level`, `source: main|support`, and a valid
numeric range for the referenced value. The phone derives its normalized fill
from that same value. Its validity and uncertainty follow the referenced item;
an expired/omitted item cannot leave a live-looking meter. No range or completion
is inferred from a clock, a unit or a full bar.

## Source properties

Common properties retain standard Pebble shapes: `schema_version` (numeric 2),
`kind`, `state`, `revision`, `name`, `caption`, `observed_at`, `valid_until`,
`private`, `unconfirmed`, `show_terminal` and optional `artwork` image/icon.
Provider identity is supplied and checked by the host, not trusted from data.

Each `main_` or `support_` prefix has `type`, `label`, `text`, `value`,
`observed_at`, `valid_until`, `retain`, `estimated`, `clock`, `base`, `anchor`
and `running`. Type and clock mode use short text; labels/text use long text;
value/base use numeric values; times use timestamps; flags use booleans. Unit
is the numeric value's unit. Missing `support_type` means no supporting item.
Meter properties are `meter_kind`, `meter_source`, `meter_min`, `meter_max`.

Source lists are complete lists, not patches. Existing UUID verification,
permission, removal, expiry, immutable-revision and tombstone rules apply.
Source availability does not refresh a saved native observation.

## ACT2 native format

All integers are little-endian. The first reference profile has two cards and
a maximum 2,672-byte frame. Frame layout:

| Offset | Bytes | Meaning |
| --- | ---: | --- |
| 0 | 4 | ASCII ACT2 |
| 4 | 1 | Version 2 |
| 5 | 1 | Card count 0–2 |
| 6 | 2 | Complete frame length |
| 8 | 2 | CRC16-CCITT, seed 65535, excluding bytes 8 and 9 |
| 10 | 2 | Reserved zero |
| 12 | 4 | Native session token, at least 2 |
| 16 | 4 | View sequence, at least 1 |
| 20 | 4 | Send time; never substitutes for source observation |

Each record has an 88-byte header, then a 36-byte canonical provider UUID, run
ID, shared string pool and optional 16-byte palette plus pixels:

| Offset | Bytes | Meaning |
| --- | ---: | --- |
| 0 | 2 | Complete record length |
| 2 | 1 | Source state: active 1, paused 2, completed 3, cancelled 4 |
| 3 | 1 | Flags: private 1, source-unconfirmed 2, show-terminal 4, image 8 |
| 4 | 4 | Source revision |
| 8 | 4 | Source observation |
| 12 | 4 | Source validity |
| 16 | 1 | Run ID byte length, 1–64 |
| 17 | 1 | Image width |
| 18 | 1 | Image height |
| 19 | 1 | Meter: none 0, progress 1, level 2 |
| 20 | 2 | Pixel-byte length |
| 22 | 2 | String pool length, at most 320 |
| 24 | 2 | Caption offset |
| 26 | 2 | Caption byte length |
| 28 | 2 | Meter fraction, rounded to 0–65535 |
| 30 | 1 | Meter source: main 0, support 1 |
| 31 | 1 | Reserved zero |
| 32 | 28 | Main item descriptor |
| 60 | 28 | Supporting item descriptor, all zero when absent |

An item descriptor has type at 0 (none 0, text 1, value 2, clock 3), flags at 1
(elapsed 1, running 2, retain 4, estimated 8), reserved zero at 2–3, observation
at 4, validity at 8, base seconds at 12, anchor at 16, text offset/length at
20/22 and label offset/length at 24/26. Times and bases are uint32; references
are uint16. Static items have zero clock fields.

Strings are valid bounded UTF-8, with no embedded NUL, followed by a NUL inside
the pool. Text is at most 192 bytes, labels 64, caption 128; all share the
320-byte pool including terminators. Offsets may share identical strings.
Required item/label and type-specific fields must be valid. Images retain the
40×40, packed-4bpp, palette and odd-row padding rules from ACT1.

Maximum record size is 88 + 36 + 64 + 320 + 816 = 1,324 bytes. Two records plus
the header fit exactly 2,672 bytes. This is explicit encoding; never serialize a
C structure by copying its padded memory.

## Native ownership and validation

Include `pebble-activity-view.h`. ARM allocations are `PavDatum` 28 bytes,
`PavCard` 1,324, `PavSnapshot` 2,664 and `PavState` 2,676. The decoder validates
the full frame before mutation and uses no allocation or second snapshot copy.
The host must not retain SDK dictionary pointers or selected-card pointers
across a callback that can replace state.

Session and view sequence reject old deliveries. Matching resident identities
reject a lower source revision, conflicting same-revision source metadata and
terminal resurrection. A newer view sequence permits different presentation
text or artwork at the same source revision. The phone separately validates
the authoritative source fingerprint before generating that view.

`pav_card_visible`, `pav_datum_visible` and `pav_meter_visible` enforce time and
retention. Formatting and clock helpers derive display values without changing
source state. Draw only visible items and schedule only clocks actually drawn.
One host timer can serve all visible clocks; source updates need not arrive
every second. Hosts own fonts, geometry, compact provenance and message buffers.

## Native Timer compatibility

Timer adds optional internal bridge key `ACTIVITY_TOTAL_DURATION` (1022), with
the configured duration. The publisher validates and preserves `totalDuration`
as immutable per-record metadata alongside existing slots and revision floors.
Old snapshots remain readable. Native persistence and app/plugin UUIDs do not change.

The legacy `session` source remains schema 1. The `card` source derives Remaining
and Elapsed from the same observation, with independent local clocks. Elapsed
means progress within the current duration setting, excluding pauses; Edit
resets that setting and its elapsed value, matching the native progress display.
Old snapshots without total duration omit the supporting clock. Cached native
data remains explicitly unconfirmed, including after reconnection.
