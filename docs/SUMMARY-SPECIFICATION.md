# Activity summaries and ACT3

Activities 0.4.0 implements `activity/summary` schema 4. Plugins publish semantic
**standard** or **media** summaries; each consumer chooses layout and priority.
The library remains a package, not an installed background service. Existing
schema 1/2/3 and ACT1/ACT2 APIs retain their meanings.

## Authoring

```js
var summary = require('pebble-activities/summary');
var provider = summary.defineProvider({
  pluginUuid: OWN_UUID,
  displayName: 'Example',
  storage: localStorage,
  readCurrent: async function () {
    return [summary.standard('tea-run-42', {
      name: 'Tea', icon: 'timer',
      headline: summary.countdown({deadline: authoritativeDeadline}),
      openApp: {watchAppUuid: TIMER_WATCHAPP_UUID}
    })];
  }
});
Pebble.registerSourceHandler(provider.handleSource);
```

Declare `provider.sourceDeclaration` or `summary.SOURCE_PROPERTIES` for the
`activity/summary` item. Suggested refresh is 30 seconds and fresh validity is
90 seconds; configure `refreshSeconds`/`validitySeconds` with validity strictly
longer than refresh. Only invoke publication through dispatched SDK requests.
The runtime must serialize requests for one provider. Helpers register no SDK
handlers themselves and start no timers.

A standard record has `id`, `type:'standard'`, `headline`, optional `detail`,
`summary:'headline'|'detail'` (headline default), `state` (active default), and
`result` (false default). Result true requires completed/cancelled state. Hidden
terminal records are omitted from the complete response.

Datums are `{type:'text',text,label?}`, `{type:'value',value,unit?,label?,range?,symbol?}`,
or `{type:'clock',mode:'countdown',deadline}` / fixed `{seconds}`. Elapsed uses
`mode:'elapsed'` with `since` plus optional accumulated `seconds`, or fixed
`seconds` alone. Clock forms cannot conflict. A source pause does not freeze
another independently running clock. Reaching zero is not completion.

A media record has `id`, `type:'media'`, `title`, optional `artist`, `artwork`,
`itemId` and `playback` (unknown default). It has no standard state, timeline,
seek or layout fields. Missing metadata remains absent.

Shared optional fields are `name`, `icon`, `visibleUntil`, `entityRef`, `actions`
and `openApp`. IDs/names/item IDs are at most 64 UTF-8 bytes; text/title/artist
192, labels32, formatted values64, units16. Trim outer whitespace and reject
controls, embedded line breaks, invalid scalar Unicode, unknown keys and
nonfinite numbers. At most16 records; timestamps are integer UTC seconds.
Bitmap bounds are40×40,4bpp,800 pixel bytes plus16 palette entries.
The [exact content model and examples](design/notification-activities-draft.md)
defines the individual fields and one-row reduction.

`openApp:{watchAppUuid}` is navigation independent of up to three contextual
SDK action bindings. Its JSON property `open_app` is capped at96 bytes;
`entity_ref` at256 and `actions` at1536. They are separately serialized from
the1024-byte content descriptor. This library validates these capabilities but
adds no Dashboard, action executor or generic app picker. Malformed optional
source capabilities are dropped independently of valid content.

## Publication and imported owners

Fresh `readCurrent` returns authoritative current records. The helper reserves
an incarnation and monotonically increasing response sequence inside the
request; these are the only persisted helper metadata. No private IDs, bodies,
artwork or fingerprints are stored. Fresh observations use capture time and
fresh records are private/transient. A saved native snapshot is not a fresh read.

Use `defineSnapshotProvider({pluginUuid,storage,readSnapshot,adapt})` for saved
owners. `readSnapshot` returns an array, or `{records,validUntilMs?}`. Each entry,
after `adapt` if provided, has `{record,revision,observedAt,validUntil,private,
unconfirmed}`. Preserve native metadata and clock anchors. The helper sequence
orders complete responses without advancing the native owner revision.

`require('pebble-activities/publisher').readSnapshots(options)` reads the saved
native slots strictly and returns cloned owner records including bridge-only
visibility/duration metadata. Corrupt storage throws. `summary.adapters.timerSnapshot`
converts those Timer records, marks saved data unconfirmed, caps paused visibility
at original observation+300 seconds and active validity at deadline+60 seconds.
Native Timer storage and Wakeup alarms remain authoritative.

Every successful response includes one reserved `@snapshot` instance, including
empty responses. Its declared properties are schema_version4,
publisher_incarnation(longText), publisher_mode(shortText fresh/snapshot),
snapshot_sequence(numericValue) and activity_count(0..16). Count excludes the
header and equals the serialized activity count. Total source instances≤17.
Each public instance ID equals the ID in its content descriptor.

Consumers reject malformed complete snapshots, old response sequences,
inconsistent response reuse, rollback and immutable owner revision conflicts.
A provider incarnation change unsubscribes the old binding and clears its native
resident view before rebinding. Managed revision floors reset only after that
clear; imported native-owner history remains. The clear barrier currently uses
the host send callback; hosts must deliver callbacks only for their actual
ordered transfer and must not report a superseded queued snapshot as accepted.
Actual phone/native transport integration is separate from portable validation.

## ACT3 native profile

Create a consumer with `nativeFormat:3`. It prefers summary, then live/card/session
compatibility, with one provider subscription. Host selection receives canonical
cards. `onView({session,viewSequence,sequence,sentAt,cards})` runs before the view
is queued, retaining phone-only destinations for exact view-index confirmation.
`consumer.view()` returns the latest frozen mapping. Source-only navigation
changes generate a new view even if drawn content is unchanged.

`summary.toView(ownerEnvelope)` compiles semantic content. `summaryView` exposes
`normalize`, `encode` and `fromLegacy`; it is available from the root namespace
or `require('pebble-activities/summary-view')`.

ACT3 retains the24-byte ACT2 frame header, replacing magic/version with ACT3/3.
The first88 bytes of each record retain ACT2 fields and two28-byte datums.
ACT3 permits absent datum labels. New record bytes are:

| Offset | Field |
| --- | --- |
| 88 | presentation: text1, media2, clock3, value4, ranged5 |
| 89 | identity symbol: activity0, timer1, stopwatch2, media3, message4, call5, navigation6, workout7, recording8, download9, delivery10 |
| 90 | selected compact datum: main0/support1 |
| 91 | main direction bits0..2, support direction bits3..5; upper bits zero |
| 92,94 | little-endian qualifier string offset/length |
| 96..103 | eight-byte media visual token; zero for other presentations |

Direction codes are none0,left1,right2,straight3,u-turn4 and apply only to values.
The record header is104 bytes, string pool≤304. Remaining provider/id/image
layouts and CRC coverage are unchanged. Maximum packet remains
`24+2*(104+36+64+304+16+800)=2672` bytes. Strings are NUL terminated UTF-8.
Essential clocks and value units remain complete; optional context yields first.
Both delivered cards remain usable after secondary-to-primary promotion.

The existing Pav C API decodes both ACT2 and ACT3. PavCard adds presentation,
identity_symbol, compact_item, directions[2], qualifier_offset/length and
visual_token[8]; `pav_qualifier` retrieves context. PavSnapshot.wire_version
identifies the decoded profile. Existing ACT2 constants keep their old values;
new PAV_SUMMARY_* constants describe ACT3. Invalid decode leaves output untouched.

Visual tokens detect media changes only; they are not authentication or source
revision identifiers. Routine clock ticks, freshness refresh and late artwork/
artist changes do not create a different media token when item identity is stable.
