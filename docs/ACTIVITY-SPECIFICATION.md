# Simple activity contract — schema 3

This is the current plugin-facing API in Pebble Activities 0.3.0. A source
publishes **content**, optional **detail** and an optional **image**, together
with its app identity and source lifecycle. A host chooses a normal or compact
presentation. Any activity kind can occupy either host role. Plugins do not
publish layouts, label stacks, meters or a general field tree.

This project convention uses existing Pebble plugin property shapes. It is not
an official Pebble standard. [The official plugin guide](https://developer.repebble.com/guides/plugins/preview/)
defines free-form source names and standard `longText`, timestamp, Boolean and
image shapes. The bounded JSON descriptors inside `longText` are this library’s
serialization convention; plugins using the helpers need not build JSON.

## Public model

```js
var activity = require('pebble-activities').activity;
var source = {
  id: 'run-42', revision: 7,
  observedAt: observed, validUntil: expires,
  state: 'active', kind: 'workout', private: false,
  content: activity.countdown({deadline: restEnds, label: 'Rest'}),
  detail: activity.elapsed({since: sessionStarted})
};
```

`activity.normalize(record, providerUuid)` validates and returns a canonical
record or `null`; it does not mutate the input. The provider helper injects its
own UUID and optional `appName`. A source must supply its stable run `id`,
monotonically increasing `revision`, original `observedAt` and `validUntil`.
Dates are UTC epoch seconds, not milliseconds. Recreating those dates during a
read of saved state would falsely renew it and is not supported.

- `content` is required; `detail` and `image` are optional.
- `state` defaults to `active`; other states are `paused`, `completed`, `cancelled`.
- `kind` defaults to `activity`; it is a semantic hint, never a layout name.
- `appName` is optional, bounded to 32 UTF-8 bytes. A host can prefer its installed
  provider display name. Identity is never guessed from content text.
- `private` defaults to true. Music and notifications are always private.
  Explicitly public data can retain its original last-reported state until expiry.
- `unconfirmed` marks retained public data. Private unconfirmed content is invalid.
- Terminal results are hidden unless `showTerminal: true` explicitly opts in.
  Reaching zero never completes a source or acknowledges an alarm.
- Unknown keys—including `main`, `support`, `meter` and `layout`—are invalid in
  this model. The older advanced model is a separate compatibility API.

All public text is bounded and normalized. Content/detail text is at most 192
UTF-8 bytes, optional semantic labels 64, formatted units 16 and descriptors 512
serialized UTF-8 bytes. These are this library’s bounds, not claimed mobile-SDK
maximums. Images use the existing palettized format, at most 40×40 and 800 pixel
bytes. An essential formatted value or unit is never silently shortened.

## Content helpers

| Input | Meaning |
| --- | --- |
| `'One More Time'` | Plain main or detail text; no extra field label |
| `{text: 'Boarding', label: 'Flight'}` | Text with an optional meaningful role |
| `activity.value(6.2, 'mmol/L')` | Finite measurement with complete units |
| `activity.value('2–1')` | Already formatted scalar, such as a match score |
| `activity.countdown({deadline: utc})` | Running countdown to a source deadline |
| `activity.countdown({seconds: 80})` | Fixed remaining duration, for a paused timer |
| `activity.elapsed({since: utc})` | Running elapsed duration since a source anchor |
| `activity.elapsed({seconds: 300})` | Fixed accumulated duration |
| `activity.elapsed({since: resumedAt, seconds: accumulated})` | Accumulated duration plus time since resuming |

A clock can be used as either content or detail. Each controls its own running
state: a paused overall activity does not freeze an independently running detail
clock. Helpers accept an optional `label` for distinctions such as Rest, Wall or
ETA, rather than forcing every text field to have a label. Values accept the
same optional metadata as a third argument, for example
`activity.value(72, '%', {label: 'Charge'})`.

Each descriptor can explicitly carry `observedAt`, `validUntil` and `estimated`
when they differ from the overall record. Item observation cannot be later than
the source observation; item expiry cannot exceed source expiry. Elapsed anchors
cannot be in the future relative to their item observation. Countdown deadlines
can already be due; the source still owns lifecycle transitions. `deadline` and
fixed `seconds` are mutually exclusive for countdowns.

`activity.toView(record)` compiles a validated model to an internal ACT2 card.
It derives mode/base/anchor and retention. Required internal native labels use
the app identity for exact suppression; plugins do not invent Track, Artist,
Text or Value prefixes. A native host may omit optional detail for its bounded
string pool or screen space while preserving the complete essential content.
Source metadata and its immutable fingerprint stay unchanged.

## Plugin source

Declare this source in the manifest. `activity.SOURCE_PROPERTIES` supplies the
same property map when producing a manifest programmatically.

```json
{
  "category": "activity",
  "items": ["live"],
  "supportsMultiple": true,
  "suggestedRefreshIntervalSec": 30,
  "properties": {
    "schema_version": ["numericValue"],
    "kind": ["shortText"],
    "state": ["shortText"],
    "revision": ["numericValue"],
    "app_name": ["longText"],
    "observed_at": ["timestamp"],
    "valid_until": ["timestamp"],
    "private": ["boolean"],
    "unconfirmed": ["boolean"],
    "show_terminal": ["boolean"],
    "content": ["longText"],
    "detail": ["longText"],
    "artwork": ["image", "icon"]
  }
}
```

`schema_version` is 3. `content` contains one flat JSON descriptor; `detail` has
the same shape when supplied. Image data is sent only when requested with
`iconPixelSize`. The source helper serializes standard base64 palette/pixels.
Unknown descriptor keys, arrays, nested objects, conflicting clock inputs,
wrong property shapes, malformed JSON and oversized serialized descriptors fail
closed. The decoder bounds bytes before parsing; no arbitrary JSON object tree
is carried to the watch.

Use `activity.createProvider({pluginUuid, appName, getActivities, now?})` for
plugins that own their records. `getActivities` returns an array of current
snapshots; it must not refresh saved observations during a poll. The provider
keeps no persistent storage and registers no SDK handler by itself. Pass its
`handleSource` to `Pebble.registerSourceHandler`, or call `source(request)` from
an existing handler. When the actual source changes, update the snapshot and
notify the SDK with `Pebble.refreshSources(['activity/live'])` as appropriate.
Private content stays transient; the helper must not be used as a disk cache.

For an existing handler, `activity.toSourceInstance(record, request)` serializes
one instance. `activity.sourceCard(instance, providerUuid)` parses and validates
it back to the public model. Returned missing detail is always `null`.

## Hosts and compatibility

`createActivities({..., nativeFormat: 2})` prefers `live` schema 3, otherwise
`card` schema 2, otherwise `session` schema 1. It subscribes once per provider,
validates the returned provider UUID and source revision/fingerprint, then
compiles the view. Malformed or redacted data clears earlier private content;
stale revisions and terminal resurrection remain invalid. Source observation,
source expiry and SDK envelope validity remain distinct.

The internal ACT2 packet is unchanged: two bounded cards can carry independent
clocks, images and source provenance. Host metadata marks `sourceFormat: 3`
after source validation. It is not a source property or an authoritative
revision field. A host can map implicit identity labels to the installed app
identity without replacing meaningful source labels such as Rest or ETA.
Provider order, enabled apps, fonts, geometry and normal/compact selection belong
to the host. The library owns no global preferences or renderers.

The advanced [schema 2/ACT2 contract](VIEW-SPECIFICATION.md) and legacy
[schema 1/ACT1 contract](SPECIFICATION.md) remain supported. Existing providers do
not silently migrate or lose their revision history. Published packages remain
immutable. Simple providers may continue advertising old items for older hosts;
new source versions fail closed on clients which do not support them.

## Native Timer and Music adapters

The native Timer publisher’s persisted schema, slot identities, source-wide
revision floor, receipt tickets and alarms are unchanged. Its independently
callable plugin uses `createProvider({..., presentation: 'simple', appName:
'Timer'})` to expose `live`, alongside old session/card sources. Active countdowns
use the saved deadline; paused countdowns use saved remaining seconds. Polling
does not renew observations, the native paused 300-second cap, or original
expiry. An acknowledged hidden completed record remains a tombstone with
`show_terminal: false`; configured duration is not repeated in the activity.

The opt-in legacy Music bridge also compiles this simple model: title content,
optional artist detail and optional artwork. It does not add Track/Artist
prefixes. Missing or known unknown-artist placeholders contribute no detail.
This cleanup is limited to Music optional metadata; arbitrary plugin text is
not reinterpreted. Music source identity, pause grace, source revision, expiry,
notification baseline gates and transient privacy remain intact.
