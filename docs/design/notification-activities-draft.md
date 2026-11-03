# Notification inspired Activities design draft

**Status: library implemented in the local 0.4.0 candidate, 3 November 2026.**
Schema4 source helpers and ACT3 are implemented; older schema1/2/3 and ACT1/ACT2
remain supported. Consumer rendering and device integration have separate
validation. The [implementation specification](../SUMMARY-SPECIFICATION.md)
records the exact APIs and finalized codec; Dashboard remains deferred.

Use two content families: **standard** and **media**. Standard summaries combine
text, values and independent clocks; media has explicit title, artist, artwork
and playback fields. Hosts own layout and animations. The library owns source
validation, publication metadata and bounded projections.

Activities remains a summary API. A dashboard can combine these summaries with
ordinary plugin readings and domain-specific detail sources. A map, complete
conversation or editing interface belongs to the originating application.
The [Dashboard integration draft](dashboard-integration-draft.md) defines
optional entity links and bounded SDK action bindings. These add capabilities
without adding content families or a second action executor.
The [app navigation proposal](activity-app-navigation-draft.md) adds an optional
watchapp destination and one Open Activity helper for both Dynamic positions.

## Ownership

```text
Authoritative current data or an authoritative saved snapshot
  -> provider helper
  -> validated semantic catalogue on the phone
  -> consumer selection and projection
  -> bounded versioned native view
  -> Dynamic, Dashboard or another application's renderer
```

Keep full source records until projection. Dynamic's two visible activities,
single compact row and contextual bottom area are consumer policies. They do
not limit how many source records exist or prescribe another app's geometry.

The provider supplies the meaning of a summary and identifies the important
value. The host chooses its presentation. A source never supplies coordinates,
font sizes, primary/secondary placement, animation frames or a layout tree.

## Exact proposed author records

A provider returns a complete array of at most **16** activity records. Every
record has an occurrence `id` and one of the two `type` values. Unknown keys are
errors. Strings are plain text, not markup.
Reject control characters and embedded line breaks; the host owns wrapping.
Trim outer whitespace and count limits on normalized UTF-8 bytes.

### Shared fields

| Field | Type and default | Meaning |
| --- | --- | --- |
| `id` | Required nonempty string, 64 UTF-8 bytes maximum | Stable identity of this occurrence; restart uses a new ID |
| `type` | Required `standard` or `media` | Content structure, not a layout |
| `name` | Optional nonempty string, 64 bytes maximum | Useful instance context, such as Tea or Living room |
| `icon` | Optional symbol name or bitmap | Override the provider's identity symbol |
| `visibleUntil` | Optional integer UTC epoch seconds | A fixed business visibility limit, such as the end of a pause grace period |
| `entityRef` | Optional same-provider source entity reference | Explicit link for a pinned entity card; defined in the Dashboard integration draft |
| `actions` | Optional array of at most three bound SDK actions | Current contextual controls; defined in the Dashboard integration draft |
| `openApp` | Optional `{watchAppUuid: string}` | App navigation separate from contextual controls; defined in the app navigation draft |

Provider UUID, display name and default icon are configured once. The consumer
can use the installed plugin's display name. They are not repeated in each
author record. IDs beginning with `@` are reserved for the source protocol.

`name` is instance context. `label` below identifies a value's role. For example,
Evening run is the activity name, while Rest identifies its countdown. Neither
is an app display name or a mandatory heading.

### Standard

```ts
type Standard = Shared & {
  type: 'standard';
  headline: Datum;
  detail?: Datum;
  summary?: 'headline' | 'detail'; // Default: headline
  state?: 'active' | 'paused' | 'completed' | 'cancelled'; // Default: active
  result?: boolean; // Default: false; true requires a terminal state
};
```

`headline` is the main meaning of this summary. `detail` is optional supporting
information and may be omitted by a constrained host. Two values are the bound;
there is no arbitrary facts collection. A consumer must not silently promote
the supporting value over the headline merely because its text fits better.
When `summary: 'detail'` selects it, detail is essential to that compact view.
Packing or fitting must preserve it or omit that view; it cannot silently fall
back to the headline. A primary still preserves its own headline first.

`summary` identifies the useful value on constrained surfaces. It does not
construct a compact row. Selecting `detail` without supplying it is invalid.
Most sources leave this field absent. A workout can explicitly select its rest
countdown for a small surface while keeping distance as its normal headline.

`state` describes the source task. Each clock has its own running/fixed form;
pausing a task does not freeze a separately running session clock. Terminal
records are hidden unless `result: true` explicitly requests a result summary.
Reaching zero, a full range or a particular text never changes lifecycle.

### Text

```ts
type Text = {
  type: 'text';
  text: string;       // Nonempty; maximum 192 UTF-8 bytes
  label?: string;    // Nonempty when supplied; maximum 32 bytes
};
```

A text datum displays its beginning, wraps only within the selected primary
layout and truncates its final visible line. Compact text uses one line. Text
never scrolls, pages or cycles automatically.
A labelled text component formats as `label: text`. Value/clock labels remain
separate context after the complete value, such as `00:45 · Rest`.

### Value

```ts
type Value = {
  type: 'value';
  value: number | string;
  unit?: string;     // Default: ''; maximum 16 UTF-8 bytes
  label?: string;    // Maximum 32 bytes
  range?: { min?: number; max: number }; // min defaults to 0
  symbol?: 'turn-left' | 'turn-right' | 'straight' | 'u-turn';
};
```

A numeric value must be finite. A formatted value is a nonempty string of at
most 64 UTF-8 bytes, such as `2–1` or `5:12`. Its optional unit stays separate:
`{value: '5:12', unit: '/km'}` is one complete value, not a clock that ticks.
There is no automatic unit conversion or clipping of a value's unit.
Append `%`, `°`, `°C` and `°F` without a space; place one space before other
nonempty units. Thus `68%`, `180°C` and `5:12 /km` stay single semantic values.

`range` is accepted only for a numeric value. Both bounds must be finite,
`max > min`, and `min <= value <= max`. A host can derive a range indicator from
that one value. No duplicate progress percentage or separate meter source is
published. A range is not proof that the task can complete: a battery level and
a download both have ranges but different lifecycles. Unknown progress uses a
text status without a range; this draft adds no continuous loading animation.

The optional directional `symbol` has a defined meaning independent of the
provider icon. It supplies the arrow in the approved navigation preview. A host
which cannot draw it must include its textual meaning, such as Turn right,
when presenting the distance. A host must not infer a maneuver from free text
or from the provider's name.

Numeric formatting preserves the source value rather than silently changing
precision to fit. Sources can provide a concise formatted value when necessary.
Unsupported Fredoka characters use the body font. If a complete essential
value cannot fit the host's readable size, that presentation yields.

### Clock

```ts
type Countdown = {
  type: 'clock'; mode: 'countdown'; label?: string;
} & ({ deadline: number } | { seconds: number });

type Elapsed = {
  type: 'clock'; mode: 'elapsed'; label?: string;
} & ({ since: number; seconds?: number } | { seconds: number });

type Datum = Text | Value | Countdown | Elapsed;
```

Countdown accepts exactly one of `deadline` and `seconds`. A deadline is a
running countdown; seconds is a fixed remaining duration. Elapsed with `since`
is a running segment and may include previously accumulated seconds. Without
`since`, elapsed seconds is a fixed duration. Elapsed requires at least one of
these fields and forbids `deadline`.

Timestamps are integer UTC epoch seconds in `1..4294967295`. Durations are
integer seconds in `0..4294967295`. A running elapsed anchor must not be later
than its actual observation. A countdown deadline may already be due; display
saturates at zero while the source still owns completion and alarm decisions.
Clock labels have the same 32-byte bound as other datum labels.

The watch calculates visible clocks locally. It does not need a phone message
per second. Boot-relative Android timestamps require conversion before entering
this UTC-based contract. A ticking display does not schedule a native alarm.

### Media

```ts
type Media = Shared & {
  type: 'media';
  title: string;   // Required, nonempty; maximum 192 UTF-8 bytes
  artist?: string; // Nonempty when supplied; maximum 192 bytes
  artwork?: Image;
  itemId?: string; // Stable media-item identity; maximum 64 bytes
  playback?: 'playing' | 'paused' | 'buffering' | 'stopped' | 'unknown';
}; // playback defaults to unknown
```

Artist also covers an author or comparable creator. Album name, timeline
position, duration, seek controls, message histories and arbitrary action forms
are outside this first content model. Optional bounded action bindings use the
Shared extension. Missing artist or artwork remains absent;
the renderer never creates Track, Artist, Unknown artist or `?` placeholders.

Media uses `playback`, not the standard task-state field. Withdrawing an item
does not issue Stop to the player. A host may hide paused or stopped sessions
according to its own media policy; polling does not restart a pause grace
window. The adapter must preserve or remember the actual playback transition.
Dynamic's existing five-second media grace starts on an observed playing-to-paused
transition in the current host session. An initially paused read does not start
a new grace unless an adapter supplies the original transition. This grace is
separate from Timer's source-owned five-minute paused visibility.

`id` identifies the player/session occurrence. `itemId` identifies its current
track or episode. Track changes do not require a new activity ID. When a source
has no stable media item ID, the host can detect changes in the title, but cannot
promise to distinguish different tracks with identical metadata. Artist-only
or artwork-only arrivals do not establish a new track by themselves.

### Symbols and images

The initial identity-symbol set is `activity`, `timer`, `stopwatch`, `media`,
`message`, `call`, `navigation`, `workout`, `recording`, `download`, `delivery`.
Provider default is `activity`. An unfamiliar domain uses a supplied bitmap or
the generic symbol; it does not need a new category or renderer.

An image uses the existing palettized bitmap shape: maximum 40 by 40 pixels,
4 bits per pixel, at most 800 pixel bytes and a 16-byte palette. There is no
URL, PNG, JPEG or SVG payload in the native view. Only generate requested
bitmap sizes; the helper keeps bitmap properties outside the bounded JSON
descriptor. The content descriptor excluding bitmaps and separately serialized
entity/action/navigation extensions is limited to 1,024 UTF-8 bytes.

An identity icon and media artwork have different meanings. Source data can
provide both; this native profile carries only one selected bitmap per card.
For media it normally chooses artwork and uses a built-in note as the compact
identity symbol. A custom icon plus artwork is not a promise that both are
drawn simultaneously.

## One row summary rules

Dynamic's compact view is exactly one static text row, optionally preceded by
a 14–16px symbol. It has one selected datum and optional static context. It has
no separate artwork block, second baseline, arbitrary inline runs or expressions.
Use exactly one leading glyph: the selected value's directional symbol first,
otherwise its activity/provider identity symbol or selected icon bitmap, otherwise
none. The primary can separately show its content arrow and contextual footer.

For a standard record:

1. Select `summary`, defaulting to `headline`.
2. Preserve that datum's type. A clock remains a clock through transport.
3. For a clock or value, reserve its complete value and unit first. Append the
   selected value's supplied label. If the unselected datum is text, append its
   label and text as static context, then the instance name.
4. For text, show its supplied label, then the beginning of the text. If the
   unselected datum is also text, append its label and text next. Instance name
   is lower-priority context if room remains. This makes a message sender plus
   body read `Petr · I’m downstairs…` and a navigation distance plus street read
   `200 m · Oak Street…`.
5. Optional context starts at its beginning and truncates at the end. Never
   scroll or cut the beginning away to expose the last words.
6. A directional symbol can lead a selected distance. Use its textual meaning
   if the symbol is unavailable.

Omit empty context and exact duplicate context components. The unselected value
or clock is never flattened into this static suffix. Showing a second live
clock requires a larger presentation, while the full source keeps both clocks.

Examples are `02:31 · Tea`, `00:45 · Rest · Evening run` and
`5:12 /km · Pace · Outdoor run`. Short names help distinguish instances;
arbitrarily long names cannot be guaranteed to remain fully visible in one row.

For media, show the beginning of the title. Instance name, then artist, are
optional context if space remains. The normal media footer remains artwork
plus artist; there is no mandatory icon-plus-app-name heading.

The standard primary shows its headline and supporting datum when it fits;
its bottom context is the instance name, falling back to the provider display
name. Media instead uses its named artist/artwork fields there. Missing media
artist does not force an app-name or unknown-artist label into that area.

If a complete value cannot fit at the readable compact size, omit that optional
secondary presentation. The source remains valid. A host must not silently
switch to a different clock, clip a unit or shorten hours to a different duration.

## Provider API and lifecycle

### Author helpers

Use a new proposed `require('pebble-activities').summary` namespace. Existing
`activity`, legacy publisher and view APIs retain their meanings. Helpers below
produce the exact records defined above; they do not add another content model.

| Proposed helper | Result |
| --- | --- |
| `standard(id, options)` | Standard record with explicit headline and optional supporting data |
| `media(id, options)` | Media record with named title/artist/artwork fields |
| `text(text, options?)` | Text datum; options can supply its label |
| `value(value, unit?, options?)` | Numeric or formatted value; options can supply label, numeric range and direction symbol |
| `countdown(options)` | Running deadline or fixed remaining seconds |
| `elapsed(options)` | Running segment with accumulated time, or fixed elapsed seconds |

For example, a source returns:

```js
return [activities.standard(timer.runId, {
  name: 'Tea',
  icon: 'timer',
  headline: activities.countdown({deadline: timer.deadline})
})];
```

The source supplies that meaningful run identity and deadline. It supplies no
wire fields, revision counters, frame timers or primary/secondary layout data.
These convenience functions register no SDK handlers.

### Fresh current reads

```js
// Implemented source4 API; invoke through the SDK request dispatcher.
var activities = require('pebble-activities').summary;
var source = activities.defineProvider({
  pluginUuid: OWN_UUID,
  displayName: 'Example',
  icon: 'activity',
  storage: localStorage,
  readCurrent: async function (request) {
    return readAuthoritativeCurrentSummaries(request);
  }
});
Pebble.registerSourceHandler(source.handleSource);
```

The helper owns no SDK dispatcher; an existing handler can route to it. It
starts no permanent process, timer or notification service. `request` supplies
the requested properties and bitmap size, not a host layout or placement.
Only route publication through a real SDK source request, not directly from
PKJS or a config callback. Config changes request a source refresh instead.
The helper provides the manifest source/property fragment, including its
internal metadata properties; the plugin still declares its SDK permissions.

`readCurrent` promises a genuinely current authoritative read and returns the
complete set. It must not read an old saved snapshot and call it current. The
ordinary author supplies semantic IDs and content; revisions, transport
sequences and fresh observation timestamps are internal.

Proposed defaults are a **30-second suggested refresh interval** and a
**90-second validity window** after a successful current read. Actual source
availability errors can clear content earlier. These are initial integration
defaults, not measured battery results or a latency guarantee. A provider can
configure a different interval and validity window for its source. The helper
requires validity to exceed the suggested interval. `visibleUntil` can cap the
window but never extends it. A clock's deadline is independent of this lease.

| Source operation | What `readCurrent` returns |
| --- | --- |
| Start | New occurrence ID |
| Update | Same occurrence ID with current content |
| Pause | Same ID and appropriate fixed clock; independent clocks can still run |
| Resume | Same ID with the correct running anchor and accumulated time |
| Restart | New occurrence ID; a numbered timer slot is not a run ID |
| Withdraw | Omit the record from the complete list |
| Finished result | Standard terminal record with `result: true` |
| Acknowledge result | Change the business source, then omit its result |
| No activities | Return `[]` |

A read failure returns a source error, not a successful empty list. Invalid
records reject the snapshot. A declined permission, redaction or malformed
private update must not leave an older private preview visible.

The helper persists only its incarnation and numeric snapshot sequence. It
stores no private bodies, artwork, activity IDs or content fingerprints. There
is no durable ActivityHandle or generic `dismiss()` pretending to cancel work.
The source owns business state and must supply a stable occurrence ID.

### Why managed publication is feasible

The current official runtime serializes source/action requests on one active
plugin object per UUID. The request mutex spans startup, asynchronous work,
reply and teardown. Config sessions use another lock and PKJS shares localStorage.
Consequently the helper reserves metadata **inside dispatched source/action
requests**, under a helper-owned key. Config code and PKJS must not write it;
module initialization must not allocate a sequence.

See [JsPlugin](https://github.com/coredevices/mobileapp/blob/master/libpebble3/src/commonMain/kotlin/io/rebble/libpebblecommon/plugin/JsPlugin.kt)
and [PluginRegistry](https://github.com/coredevices/mobileapp/blob/master/libpebble3/src/commonMain/kotlin/io/rebble/libpebblecommon/plugin/PluginRegistry.kt).
This is a dependency on the runtime's serialization behavior and needs an
integration check when supported runtime versions change. An alternative
execution model requires a single-writer or atomic metadata adapter.

Reserve and read back the next sequence before returning data. Failed metadata
acceptance returns a content-free storage error. Sequence gaps are harmless;
wrapping to a reused sequence is forbidden. Storage read-back does not promise
disk flush or power-loss durability.

### Saved native and external snapshots

```js
// Imported-owner API preserves native metadata.
var source = activities.defineSnapshotProvider({
  pluginUuid: TIMER_UUID,
  storage: localStorage,
  readSnapshot: readSavedOwnerSnapshot,
  adapt: activities.adapters.timerSnapshot
});
```

The adapter preserves the owner's run ID, version, observation, validity,
acknowledgement/result visibility and clock anchors. A source read can renew
the outer provider-availability envelope; it cannot renew that saved truth.
Sensor APIs returning an earlier sample time use this timestamp-preserving path.
Its helper sequence store orders complete replies independently of the owner
version, including replies where records expired. It uses the reserved helper
key and never advances Timer's native revision on read.

Timer keeps its current native models, eight slots, saved banks, Wakeups,
publication tickets and receipts. Paused visibility stays capped at the
original pause plus five minutes; reconfirmation does not extend it. Confirmed
acknowledgement stays authoritative and restart creates a new run.
The current active Timer lease ends sixty seconds after its saved deadline;
preserve that existing limit. A missed completion update can therefore leave
a brief zero prediction, not an indefinitely renewed finished activity.

A valid saved deadline may be used as a bounded prediction under its existing
lease. It does not establish that the closed native app is currently running.
If the owner is edited offline, an updated phone view must await delivery.
Source removal, expiry and explicit invalidation retract it. A native countdown
may not be inferred to have fired or been acknowledged merely from zero.

Do not solve the removal of Last reported UI by refreshing old observations.
Fresh-read providers clear on unavailability. An imported saved clock needs an
explicit adapter/host policy for its existing lease; a generic retained sensor
value is not silently upgraded to current data. If its meaning requires a trust
annotation that the simple view cannot show, omit that view instead.

### Commands

Local Hide belongs to the host. Cancel, Pause, Resume and Acknowledge belong to
the authority. Controls need advertised SDK actions targeting the exact
provider and occurrence, permission checks and a confirmed outcome. A subsequent
source read supplies the changed state. Timer's currently read-only provider
does not gain native command delivery through this design.
The [optional action extension](dashboard-integration-draft.md#actions) supplies
current bindings and arguments. Dashboard owns controls and confirmation UI;
display-only Dynamic ignores the extension. SDK delivery and business execution
remain separate from the activity lifecycle.

## Complete source snapshot protocol

Use a new source item, provisionally `activity/summary`, with source schema 4.
Older `live`, `card` and `session` items stay separate compatibility projections.
New consumers prefer summary when supported. Older consumers do not parse a
new descriptor as schema 3.

The SDK preserves `validUntilMs` and `instances`; arbitrary extra envelope
fields are not a sequence channel. Include one reserved internal `@snapshot`
instance even when the public result is `[]`. Its declared properties carry:

| Property | Meaning |
| --- | --- |
| `schema_version` | Proposed value 4 |
| `publisher_incarnation` | Helper metadata generation |
| `snapshot_sequence` | Monotonically increasing complete-response sequence |
| `publisher_mode` | Internal fresh/snapshot owner mode; controls incarnation reset behavior |
| `activity_count` | Expected number of activity instances, 0–16 |

Each activity instance has the public ID and a bounded content descriptor;
bitmaps use separately declared image/icon properties. The helper adds owner
revision, observation, expiry, privacy and trust properties. Fresh records use
the current capture and managed version; imported records preserve their owner
metadata. The internal metadata instance is never a catalogue activity.
Optional `entity_ref`, `actions` and `open_app` properties use separately bounded
`longText` JSON descriptors. They add no activity instances or native Dynamic
display fields; navigation confirmation uses its own small status channel.
Their changes are ordered by the complete snapshot sequence independently of
an imported owner's unchanged business revision.

Thus one source reply can contain 17 instances: one metadata instance and up to
16 activities. This is a new convention; it does not change the older decoder's
limits. All property names and shapes must be declared in the manifest. A
response with a missing header, mismatched count, duplicate ID, invalid record
or unsupported schema fails as a whole.
Here invalid record means invalid required core content/owner metadata. A
consumer drops malformed optional entity/action/navigation extensions and
invalidates their old links/tokens/destinations while preserving valid core
content. Producer helpers remain
strict about malformed authored input, including optional fields.
The count describes serialized activity instances after expiry filtering, not
the original array length returned by the source.

Consumers validate the complete snapshot sequence before replacing the source
set. An older nonempty response cannot undo a newer empty withdrawal. Keep
owner-level revision and terminal checks for imported records as well. Full
snapshots cannot be repurposed as pages: omission means withdrawal here.

An incarnation change clears and rebinds the provider before establishing a new
baseline. Ignore callbacks from the old binding. Rotate/clear the native view
session before presenting reset source revisions. Keep unrelated providers in
the phone catalogue for reprojection. A helper reset does not authorize resetting
a native owner's revision history or resurrecting its acknowledged results.

The fresh-read helper marks both standard and media records private/transient.
Media is always private; layout type must never relax permissions or retention.
Native/public snapshot
adapters retain their established policies explicitly. Source SDK permissions,
display privacy and persistent-cache policy remain separate concerns.

## Dynamic native profile

Use a new frame version, provisionally ACT3. Existing reserved ACT2 bytes retain
their meaning. Keep the host's existing AppMessage queue and message-key numbers.
Native receives selected views rather than the phone catalogue or JSON content.

Proposed primary presentation codes are text, media, clock, value and ranged
value. They are compiler decisions from validated content, not additional
developer layout choices. Each card retains two typed datums. A media view uses
them for title and artist. A value's range indicator derives from that datum.

| Component | Proposed maximum bytes |
| --- | ---: |
| Frame header | 24 |
| Per-card record header | 104 |
| Provider UUID | 36 |
| Occurrence ID | 64 |
| Per-card string pool | 304 |
| Selected image palette | 16 |
| Selected image pixels | 800 |
| Cards | 2 |

The maximum remains `24 + 2 × (104 + 36 + 64 + 304 + 16 + 800) = 2672` bytes.
The proposed record header trades 16 bytes of the old string pool for explicit
presentation metadata:

| Added field | Bytes |
| --- | ---: |
| Primary presentation code | 1 |
| Identity symbol selector | 1 |
| Compact datum selector | 1 |
| Directional symbols for both datums, three bits each | 1 |
| Compact qualifier offset and length | 4 |
| Media item visual token | 8 |

This is a capacity allocation, not a finalized byte-offset specification. Define
the exact field offsets, enum codes, image-role rules, bounds and CRC coverage
before writing an encoder. Record headers remain versioned rather than being
inferred from old labels.
Each three-bit directional code represents none or one of the four defined
maneuvers; the two upper bits remain zero. This preserves different headline
and detail directions when a compact view selects the supporting value.

The qualifier contains only static context. The selected native datum remains
structured for local ticking. String packing deduplicates strings and trims
optional projected text on UTF-8 boundaries. Essential values and units remain
complete; an unprojectable view yields without invalidating its source record.
Optional context must be trimmed before the selected datum can be displaced.
The first profile draws at most one range indicator, derived from a ranged
headline. A supporting value keeps its complete value/unit; its range need not
be drawn. Both original ranges remain in the phone's semantic catalogue.

Each delivered card must remain usable in both Dynamic roles. If the primary
expires locally, the surviving secondary can become primary before the phone
responds. Preserve both the headline and the selected compact datum when they
differ. Do not strip media artwork merely because its card is currently compact;
the leading compact glyph uses a built-in note while the cover remains available
for promotion. Fitting can shorten optional text from its end, not substitute a
different essential value. If both required presentations cannot be represented,
the card cannot be included in this role-switching profile.

Select one bitmap per card. Identity can use a built-in glyph when artwork
occupies the bitmap. A directional content glyph remains separate from the
provider identity. An unsupported glyph must have a readable semantic fallback.

Dynamic's agreed geometry is 200 by 228: compact content in one row near
y96–114, primary below it, contextual footer ending at y216. With no secondary,
the primary expands upward. Media uses up to two title lines with a secondary,
three without, and a 40px artwork/artist footer. Other hosts set their own bounds.

Dashboard may select more source records through its own bounded view/window.
It must define delivery and memory limits around that UI rather than change
the global two-card constant. A future paged catalogue protocol needs explicit
page identity/completeness and is separate from complete source snapshots.

## Transitions and power

Compare occurrence identity for activity replacement and stable media item
identity for a track change. Do not trigger transitions on source revision,
snapshot sequence, freshness renewal, clock ticks or late artwork/artist.

Retain only the outgoing visible presentation needed for one short transition.
Do not keep pointers into replaceable receive buffers, duplicate a catalogue,
allocate images per frame or keep animation timers for hidden content. Privacy
withdrawal, source removal and expiry cancel and erase outgoing content too.

Clock/date/weather stay visually steady during a track change. Song-only motion
should invalidate the activity layer only; the older synchronization function
also dirties the background and cannot be reused unchanged for that promise.
Text stays still after the transition. Unknown progress does not continuously
animate. Physical-watch battery cost remains a measurement.

## Feasibility and implementation boundaries

The published Dynamic 0.11.0 audit records 64,908 virtual bytes against a
65,535-byte limit, leaving **627 bytes**. Loaded image is 64,488 bytes. These
figures do not measure runtime heap or worst-case stack. See the
[published audit](https://github.com/xefensor/dynamic-watchface/blob/v0.11.0/docs/qa/0.11.0/native/bundle-audit.json).

Replace/refactor existing generic and legacy-media rendering rather than add a
third parallel renderer. Removing text continuation and diagnostic-age layouts
may recover space; the final native build must establish that it fits. Packet
arithmetic does not prove executable size, heap, stack or power consumption.

| Check | Required result |
| --- | --- |
| Two named timers | Distinct IDs; useful context in either position |
| Workout distance plus rest countdown | Typed clock; explicit summary selection |
| Paused workout plus running session clock | Independent clock behavior |
| Score plus match clock | Preserve both typed source values; compact selects one; no per-second phone messages |
| Oven temperature plus remaining time | No inference that temperature is progress |
| Known download range | One value drives text and indicator |
| Unknown progress | Honest static status |
| Media without artist/artwork/item ID | Readable fallback; limited change detection acknowledged |
| Late artwork or lease renewal | No new-track animation |
| Navigation | Direction supplied explicitly; text fallback preserves it |
| Empty newer source snapshot then older response | Activity stays withdrawn |
| Acknowledged result then cached native record | No resurrection |
| Paused Timer repeatedly polled | Original five-minute cap remains |
| Active saved Timer reaches zero without an owner update | Prediction expires under the original deadline-plus-sixty-second lease |
| Primary expires while phone is unavailable | Secondary can promote with its own headline, selected value and retained artwork |
| Permission denial or source removal during animation | Current and outgoing private content disappear |
| Provider metadata storage reset | Rebind and establish a new baseline |
| Helper reset after a Timer acknowledgement, then old owner data | Owner history still prevents result resurrection |
| Long values and multibyte text | Complete units/clocks or omitted optional view; safe text truncation |
| Repeated transitions and mixed frames | Bounded memory with no steady allocation growth |
| Native build | Executable, runtime heap and stack fit measured budgets |

The next implementation starts with validated source records and provider
snapshots, then a cross-language versioned view, then Dynamic's renderer.
Adapt Timer on the phone without changing its native alarm/storage ownership.
Keep older formats and published releases intact. Source helper, wire and
renderer integration each need validation before a release can claim support.

## Related review material

- [Concrete records and reduction cases](notification-activities-examples.json)
- [Dashboard bindings and optional controls](dashboard-integration-draft.md)
- [App destinations and one configurable Quick Launch helper](activity-app-navigation-draft.md)
- [Approved layout previews in the local workspace](../../../design-previews/dynamic-activities/preview.html) (workspace-only link)
- [Current implemented schema 3](../ACTIVITY-SPECIFICATION.md)
- [Current ACT2 view](../../include/pebble-activity-view.h)
- [Official plugin execution model](https://developer.repebble.com/guides/plugins/preview/#the-script)
- [Wear OS ongoing activities](https://developer.android.com/training/wearables/notifications/ongoing-activity)
