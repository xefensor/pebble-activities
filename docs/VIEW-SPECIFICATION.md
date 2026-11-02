# Activity cards and ACT2 version 2

**Advanced compatibility and native transport.** New plugins should use the simpler
[notification-style activity API](ACTIVITY-SPECIFICATION.md). This document
preserves the existing source/native compatibility contract.

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
`nativeFormat: 2`. It prefers a compatible provider’s simple `live` item, then `card`, otherwise
adapts `session` version 1. It never subscribes twice merely to show both forms.
`catalogue()` and `select()` receive canonical main/support objects for v2.
`reproject()` republishes a host selection without rebinding providers. The
default consumer still uses schema 1 and ACT1.

The helpers are independent of Dynamic. Its phone host keeps its own selection
policy; another app can use a different bounded selection and native layout.

### Provider identity and host ordering (0.2.2)

`consumer.providers()` returns a copied installed-provider catalogue of
`{uuid, name, item, available}` entries, including compatible apps which are idle
or disabled by the host. `uuid` is validated; `item` is the selected compatible
source. `name` is bounded, sanitized display metadata from the SDK enumeration's
`plugin.name`, as used by the official
[plugin-test application](https://github.com/coredevices/pebble-apps/blob/main/plugin-test/src/pkjs/index.js).
An empty name is permitted. Availability here means present in the latest valid
enumeration, not permission granted, a live activity or fresh source content;
`status()` continues to report subscription health. A successful enumeration
replaces the catalogue, so removed providers disappear. No private source data
enters this catalogue.

Canonical cards passed to the host selection callback include `providerName`
when enumeration supplies it. This is host metadata attached after source
validation. It is excluded from source fingerprints, revision immutability and
native encoding. Renaming an app can change its presentation without changing
the activity's source revision. A host must never use a display name to establish
provider identity, deduplicate unrelated sources or infer lifecycle.

`activities.selection.select(cards, {order, hidden, limit})` is an optional pure
helper. `normalizePreferences(value)` sanitizes its `order` and `hidden` arrays;
`providerKey(card)` exposes the corresponding stable preference key. The helper
persists nothing and returns original card references. Keys are validated UUIDs,
plus the reserved host-adapter key `builtin:music` described below. Unknown keys
cannot introduce content. Duplicate/invalid keys are removed and each preference
array is bounded to 64 entries. `limit` is zero, one or two (default two).

Ongoing records precede explicitly visible terminal results. Explicit provider
order then applies; unlisted providers retain the input's stable fallback order.
Within a provider, active countdowns are ordered by their absolute deadline,
followed by paused countdowns by remaining duration, in that provider's existing
countdown positions. Other providers and non-clock items retain their positions.
The helper does not impose a global provider-kind priority. A watchface, Dashboard
or another host chooses its default order and whether to offer settings. Save
only stable provider keys, never current track names, run IDs or private cards.

A host may project a **copy** into existing ACT2 caption/artwork fields after
source validation, for example a bounded app name and a recognizable icon for
each displayed activity role. Source `kind` remains an open string; a host can
use known explicit kinds for fallback symbols and use a neutral symbol/name for
unknown kinds. Countdown shape does not prove a timer, and free text does not
prove music. Keep role labels such as `Rest`/`ETA`, essential main values/units,
per-item observation/provenance, privacy and lifecycle intact. Supporting content
may be omitted when necessary for the existing 320-byte string pool; if its meter
is omitted, remove the corresponding meter too. Never repurpose reserved packet
bytes or change source truth to fit a layout. This requires no ACT2 ABI change.

### Optional legacy Music activity bridge

`createContext` preserves its existing subscriptions, notice baseline/privacy,
transport and defaults. It adds optional `onChanged()` notification and
`musicActivity()`, which returns a copied canonical private ACT2 card or `null`.
The card comes only from a fresh validated native Music source record, retains
the original receipt observation/lease, and never refreshes on accessor calls,
reprojection or unrelated phone/notification updates. A real SDK `pluginUuid`,
when supplied, must be a valid UUID and remains the native provider identity.
Older envelopes lacking it use the explicit host-adapter namespace
`718089b7-d9d4-4d6b-81c0-915dcd4c7e4a`; this never claims an unknown real provider.
An invalid supplied UUID disables canonical adaptation for that delivery.

The bridge assigns transient run/revision IDs: a track/provider change starts a
new adapter run, authoritative source callbacks advance its revision, and polling
does neither. `selectionKey: 'builtin:music'` is host-only preference metadata;
it must never replace the canonical UUID in the wire record. `musicProvider()`
returns content-free metadata for a currently available bridge. Title, artist
and artwork exist only in transient memory and native delivery. Pause grace,
expiry, source removal/redaction/error, disconnect, disable and stop clear the
accessor. Bitmap rows are converted to ACT2's tightly packed format.

Hosts migrating Music into their activity roles can opt into
`musicAsActivity: true`. While a valid bridge exists, the old context packet's
Music title/artwork and artist slots are empty; notifications and phone status
are unchanged. This prevents a host-hidden Music card reappearing in a fixed
compatibility footer. The default remains the existing context packet. Connect
`onChanged` to the host's `activities.reproject()` and merge `musicActivity()`
before selection, so source changes and expiry retract either activity role.
The host must continue sending the activity transport even if it hides other
plugins. Deduplicate dual-convention Music only by verified source identity,
never by comparing track text.

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
the activity. Native Timer opts into a brief unacknowledged completed result;
Done publishes a newer hidden completed revision, while cancellation still
retracts it. Acknowledgement does not change completion into cancellation.

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
the current run's duration span. The publisher validates and preserves `totalDuration`
as immutable per-record metadata alongside existing slots and revision floors.
`ACTIVITY_SHOW_TERMINAL` (1023) adds optional Boolean `showTerminal` metadata;
native dictionaries accept only Boolean values or numeric zero/one. Done keeps
the source state completed, advances its revision, and publishes false. The
hidden result remains a revision tombstone until its original validity, with
no renewed observation or visibility on polling/reconnection. Visibility
changes at the same revision conflict just like duration changes. Older
snapshots without this optional metadata retain the preceding projection
behavior. Neither schema nor the ACT1/ACT2 packet format changes.

The legacy `session` source remains schema 1. By default the `card` source
derives Remaining and Elapsed from the same observation, with independent local
clocks. Elapsed means progress within the current run span, excluding pauses.
Old snapshots without total duration omit the supporting clock.

An independently callable provider may explicitly choose
`createProvider({ ..., timerPresentation: 'compact' })`, also supported by
`view.fromLegacy`. For Timer deadline records this omits the derived elapsed
clock and uses the identity caption as the main label; both are bounded to the
same 64 UTF-8 bytes so hosts can deduplicate them by exact equality. Without a
caption, the meaningful clock label remains. Completed Timer results likewise
omit their derived elapsed clock. This is a projection choice: the stored
`totalDuration`, source revision, original observation/expiry, schema 1 response
and unrelated activity labels/supporting items remain unchanged. The default
`timerPresentation: 'detailed'` preserves the previous projection. Cached native
data remains explicitly unconfirmed, including after reconnection.
