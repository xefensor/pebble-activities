# Dashboard plugin integration draft

**Status: design proposal, 3 November 2026.** This extends the
[Activities proposal](notification-activities-draft.md). It defines Dashboard
integration and optional activity metadata; it does not implement a Dashboard,
change the published Activities APIs or add native Timer controls.

Dashboard consumes the existing plugin SDK. One installed plugin may provide
ordinary readings, action commands and Activities summaries. Dashboard combines
them in one card system. An ongoing activity is useful additional content, not
a requirement for exposing a temperature, a light switch or Find phone.

## User experience

Use one ordered Dashboard list. User-pinned cards stay first in their saved
order. Eligible live activities not already represented by a pinned card follow
in a Live group. Dashboard's provider order and hidden items are independent
of Dynamic's settings.

The first view shows four readable rows, with selection opening a dedicated
detail screen. Controls appear in an action menu on that screen. A later grid
can reuse these bindings, but the first implementation should not squeeze large
artwork, several values and tiny controls into every overview tile.

A card can show information, have controls, or do both:

| User adds | Persistent card | During a relevant task |
| --- | --- | --- |
| Phone battery | Battery reading | Remains a battery reading |
| Kitchen light | State and configured On/Off controls | Remains the chosen device control |
| Washer temperature | Temperature reading | Still shows temperature by default |
| Whole washer device | Base reading and configured controls | Can show a linked cycle's summary and its published controls |
| Next Timer | Selected future running countdown, or No upcoming timer | Follows a new eligible Timer occurrence |
| Now playing | Current media summary, or Nothing playing | Title, artist, artwork and available playback controls |
| Find phone | Standalone command | No invented activity is necessary |

Hybrid behavior is explicit. A user who pinned a particular measurement should
not see that measurement disappear merely because a device starts a task.

## One card configuration

These are proposed Dashboard settings, not fields a plugin must publish:

```ts
type DashboardCard = {
  id: string;                    // Dashboard-local configuration identity
  label?: string;                // User override, not source identity
  content?: ReadingBinding | ActivityBinding;
  controls?: SavedActionBinding[];
  followLinkedActivity?: boolean; // Default false; reading content only
};
```

Require content or at least one control. Start with a maximum of eight pinned
cards and three configured controls per card. The automatic Live list is a
separate window over available activity records; it is not limited to eight.
These are initial UI bounds, independent of the sixteen-record provider limit.
The phone activity catalogue initially follows the existing discovery bound of
32 enabled providers and sixteen summaries each, at most 512 records. Settings
must expose the enabled-provider limit instead of silently treating unobserved
providers as empty. Native still receives only its current four-row window.

Default Select opens detail. An explicitly configured action-only shortcut may
run its one command after Select; destructive or confirmation-required commands
still open confirmation. Selecting a live feed row never silently executes an
operation. A card containing several controls opens its action menu.

### Ordinary readings

```ts
type ReadingBinding = {
  kind: 'reading';
  plugin: string;     // Exact provider UUID
  category: string;
  item: string;
  instanceId: string; // Stable SDK source instance, not an array index
  property: string;
  shape?: string;     // Default auto, or an actual supported SDK shape
};
```

Scalar shapes are `shortText`, `longText`, `numericValue`, `timestamp`,
`boolean`, `icon` and `image`. Series use actual names such as
`series.numericValue`; keep their start/step and missing samples. Do not turn
the first series point into a current reading or wrap a forecast in a fake run.

An auto renderer chooses a supported shape. An explicit user choice preserves
that choice. A missing selected property is unavailable; the host must not
substitute another property with a similar name. Specialized weather or chart
views can later consume ordinary sources without requiring Activities adoption.

Verify the returned envelope's provider UUID. A pinned device is not allowed
to switch providers when SDK source fallback occurs. A future user-selected
preferred-provider mode would be a separate explicit binding policy.

### Activity selection

```ts
type ActivityBinding = {
  kind: 'activity';
  plugin: string;
  select?: 'first-visible' | 'next-running-countdown';
}; // Default: first-visible
```

`first-visible` follows the provider's meaningful source order after visibility
and terminal filtering. Never sort it by polling time, observation time or
revision. `next-running-countdown` considers active standard records whose
headline is a running countdown with a future deadline. Choose the earliest
deadline; ties keep source order. Exclude paused/fixed clocks and terminal
results. This selection policy is not a source lifecycle transition.

No match leaves the pinned card in place with an idle message. It does not
remove the card, collapse configured positions or switch to a different plugin.
Persist the provider and selection rule, not the currently displayed run ID.
For Next Timer the empty label is No upcoming timer, not a claim that the
source has no running task. A source-active due/zero prediction can remain in
Live under its original validity until its owner updates or it expires.
Distinguish a successful empty source from Loading and Unavailable states.

Automatic Live rows use occurrence identity. When a source withdraws one, its
automatic row disappears. While a detail/action screen is open, keep focus on
the selected occurrence. Its removal produces an ended/unavailable screen and
invalidates its controls; do not retarget the screen to the next run.
Default Live ordering is configured provider order, then source order. Initially
use provider display name plus UUID as a deterministic default provider order.
Do not reshuffle the list every second as countdown text changes. Keep selection
anchored to the same row key when new automatic rows arrive.

### Persistent entities and linked activities

An optional Activities extension links an occurrence to an ordinary source
entity in the same verified provider:

```js
entityRef: {
  category: 'home',
  item: 'appliance',
  instanceId: 'washer-1'
}
```

The persistent device is `washer-1`; its current occurrence might be
`wash-run-42`. The next cycle keeps the device reference and gets a new run ID.
The reference identifies the entity, not one property. Each component is a
nonempty string of at most 64 UTF-8 bytes. No plugin override is allowed.

An enabled `followLinkedActivity` matches provider/category/item/instanceId
exactly against the reading card. Never infer a relationship from a name,
value, app name, bitmap or provider UUID alone.

| Situation | Whole-device hybrid card |
| --- | --- |
| No linked activity | Base reading and explicitly configured base controls |
| One eligible linked activity | That activity's content and published contextual actions |
| Linked activity has no actions | Activity content remains read-only; no invented Pause/Stop |
| Several linked activities | First in provider order, with access to the other occurrences |
| Displayed activity ends | Restore base content and base controls |
| Base reading unavailable, valid linked activity available | Show that independently valid activity |
| Neither valid base content nor linked activity | Show unavailable content; never a guessed Off state |

When the activity takes over, its contextual actions replace the base controls,
including when its action list is empty. This avoids leaving an idle Start
button attached to a running cycle. The provider must actually implement Stop
for the example to have a Stop button.
Takeover and restoration describe the overview. An already open activity detail
or menu stays tied to its exact occurrence; ending the task disables that view,
and returning to the overview reveals the restored base card. Stop must not
silently become Start under the user's selected control.

A missing property/sample is not evidence that its entity was deleted. An
independently valid linked activity can still provide content. Explicit entity
deletion, a broken reference or provider removal clears the relationship;
ordinary read failure alone does not invent a deletion or another entity.

Only the occurrence actually shown by a pinned card is suppressed from the
automatic Live list. Other activities from the same entity/provider remain
available. Explicit duplicate user pins are not silently retargeted to different
occurrences. A plain measurement pin with following disabled consumes no activity.

Current Timer supplies run summaries, not a permanent timer-entity source.
Its eight native origins/slots can be reused after deletion. Initial Dashboard
support therefore offers Next running timer and the live occurrence list.
Pinning one saved timer across deletion/recreation requires a real stable
definition identity with deletion semantics and a corresponding entity source.
It must not be implemented by remembering a slot number or matching a name.

## Actions

All actions execute through the existing SDK `Pebble.invokeAction` route.
Activities contributes current bindings; it does not create a second action
executor, permission system or command service.

### Optional activity action bindings

```ts
type ActivityAction = {
  id: string;       // Stable control slot; maximum 32 UTF-8 bytes
  label: string;    // Required readable label; maximum 32 bytes
  action: string;   // Exact declared SDK action; maximum 64 bytes
  args?: object;   // Default {}; maximum 256 serialized UTF-8 bytes
  semantic?: 'play' | 'pause' | 'resume' | 'stop'
           | 'next' | 'previous' | 'cancel' | 'acknowledge';
};
```

A source may provide up to three bindings. IDs must be unique in the activity.
Arguments must be JSON objects with finite numbers, no executable values and
maximum nesting depth four. The complete array is limited to 1,536 UTF-8 bytes.
An arbitrary operation can omit `semantic` and use its explicit label. Semantics
select presentation hints; they never implement the operation or generate args.

The verified activity provider is the target plugin. A descriptor cannot redirect
to another plugin. The action must exist in that provider's manifest. Its
parameter schema stays in the manifest rather than being copied into each record.
The handler must validate arguments and the actual target; the current SDK does
not perform full JSON-schema value validation on invocation.

List only applicable actions. Omission means read-only. Pending/disabled state
is host UI state, not an `enabled` expression from the provider. There are no
general conditional expressions, input forms, callbacks or drawing instructions.

For media, a stable `playback` binding changes its explicit operation:

```js
// Playing
{id: 'playback', label: 'Pause', semantic: 'pause',
 action: 'set_playing', args: {on: false}}

// Paused
{id: 'playback', label: 'Play', semantic: 'play',
 action: 'set_playing', args: {on: true}}
```

Previous and Next bind the existing `previous_track` and `next_track` actions.
There is no inferred toggle. The built-in Music action controls the current
player; the binding does not grant precise multi-player or atomic track targeting
that the underlying action lacks.

For job/session actions, arguments must contain the real owner-required run or
entity identifier, and an expected owner version if that API supports one.
Manifest source targets do not automatically tell Dashboard which arbitrary
argument receives an Activities occurrence ID. The provider binds it explicitly.
The owner must reject a stale run before changing a replacement run.

### Standalone and reading controls

```ts
type SavedActionBinding = {
  plugin: string; // Valid UUID; user explicitly selected this provider
  action: string; // Exact declared action; maximum 64 UTF-8 bytes
  args: object;   // JSON object, maximum 256 encoded bytes/depth four
  label?: string; // Optional nonempty user label, maximum 32 bytes
};
```

An action-only card uses this binding without content. A reading card can use
one or more of these controls. These are explicit user settings; they may target
a different plugin only when the user selected that command. Source-provided
activity bindings always remain scoped to their verified provider.
If the saved label is absent, use a short declared description when available;
otherwise use the action name. Fit the projected label from its beginning and
truncate at its end to the 32-byte rendered-label bound. Do not discard the
full manifest metadata or substitute another action to obtain a shorter label.

The first Add flow supports actions needing no arguments, manifest-supported
entity/item binding where the parameter convention is explicit, and presets
configured on the phone. Simple primitive parameter entry can use the manifest;
arbitrary object forms and free-form JSON editors are not initial watch UI.
Unsupported parameter workflows remain in the originating plugin/app.

A desired-state command such as Turn off Kitchen light uses a fixed entity ID
and `on: false`. A stateful On/Off switch needs two explicitly configured desired-
state bindings and the actual boolean reading. Unknown state is not False.
There is no expression engine guessing command names or substitutions.

Permission and confirmation flags come from the SDK declaration. Dashboard
honours `destructive` and `requiresConfirmation`; a harmless-looking source label
does not bypass those flags. Do not depend on a permission-query API before
the runtime supports it: invocation still goes through SDK enforcement.

Unavailable reading content does not necessarily invalidate every independent
command. A stateless Find phone or explicitly configured desired-state command
can remain usable if its plugin/action is available. A state-derived switch
cannot guess its next state, and an expired activity cannot keep its old actions.

Persist only user-created bindings/settings. Never persist automatically supplied
activity action arguments, live source data or an old run's private content.
An activity-specific Pause binding is not a permanent reusable preset.

## Bounded invocation and feedback

Keep exact SDK selectors, action definitions and arguments on the phone. Native
Dashboard receives bounded labels, semantics and opaque control tokens.

1. Validate the installed provider, declared action and fully supplied arguments.
2. Bind a token to the host session, stable control slot, target entity/occurrence
   and exact current action/arguments. Media can also bind its known item token.
3. On press, native sends session, token and a new command request ID.
4. Phone rechecks the current binding and required confirmation, then invokes
   `Pebble.invokeAction({plugin, action, args})` once.
5. Show pending UI. One control has at most one pending command; initial host
   limit is four pending commands globally.
6. Use the SDK result for feedback and refresh affected sources. Reported source
   state determines the displayed device/playback state.

Deduplicate retransmissions of the same native command request ID in transient
phone state. IDs increase monotonically and never repeat within a native session;
dispatch commands through the host queue in order. Keep at most four pending
entries, sixteen recent results, and an accepted-ID high-water mark for the
session. A known duplicate returns pending/result status without invoking again.
An older request whose result was evicted is rejected, never re-executed. Reusing
an ID with a different token is invalid. A phone-host restart requires a new
session handshake before accepting commands; old requests are not replayed.

Keep tokens stable across unrelated value updates. Invalidate them
when the target, arguments, capabilities, binding, session or relevant media item
changes, or on source withdrawal and permission loss. Confirmation refers to
that exact token; revalidate after the user answers.
If confirmation needs a second round trip, use a short-lived confirmation ticket
for the exact binding and a new command ID on confirmation. The first response
does not execute the operation. Reject a confirmation after its binding changes.

Preflight is not an atomic backend transaction. The owner must enforce any
required run/version guard. The global current-player Music commands have their
documented weaker targeting. A transport ACK means delivery, not that an action
was performed or a native timer paused.

On timeout the action may have executed. Show unconfirmed outcome and refresh;
never automatically skip again, toggle again or replay after reconnect. An
already issued operation may finish after the user leaves; do not silently
cancel it or display stale private result text in a replacement card.

Timer's current provider is read-only. Initial integration shows its countdowns
and can offer verified host-owned navigation to the Timer app when available.
It offers no Pause/Cancel controls until a real native command route exists.
Opening the Timer app does not imply selecting or operating a particular run.

## Source extension and compatibility

The two activity content families stay unchanged. Add optional `entityRef`,
`actions` and `openApp` to Shared author records in the proposed schema-4 helper.
Serialize them separately from the 1,024-byte content descriptor:

| Optional SDK property | Shape | Maximum serialized bytes |
| --- | --- | ---: |
| `entity_ref` | `longText` containing bounded reference JSON | 256 |
| `actions` | `longText` containing the bound action array | 1,536 |
| `open_app` | `longText` containing `{watchAppUuid}` JSON | 96 |

These properties must be declared by the new helper and requested by consumers
that use them. Their omission is valid. They add no activity instances and do
not change `@snapshot.activity_count`. Dynamic does not request actions or carry
them in its native packet; the proposed navigation integration requests
`open_app` on the phone and uses a separate native presentation-status channel.

Producer helpers reject malformed authored metadata. Consumers discard an
invalid optional action list and its old tokens while retaining valid summary
content. An invalid entity reference disables linking; it never creates a guessed
link. Invalid core content retains the source snapshot's strict failure rules.
Invalid optional navigation removes Open app without invalidating core content
or independently valid contextual controls.

The complete source snapshot sequence orders extension changes. Imported
native owner versions still govern native truth; runtime action availability
and host bindings do not manufacture a new native observation or owner revision.
Keep the owner's fingerprint separate from optional runtime binding metadata.
Never advertise native controls solely from an old cached task state.

The old schema-3 author normalizer still rejects new keys. These extensions
belong to the new draft contract; no existing package is claimed to accept them.

## Opening associated apps

An optional `openApp: {watchAppUuid}` identifies the native app to open. It is
navigation, not one of the three contextual action slots. Overview Select keeps
opening detail; Open app is available in detail/menu when a valid destination
exists. An explicit host binding can use the same destination for an ordinary
reading. This does not infer a watchapp from a phone plugin UUID or promise a
generic app picker unavailable through the current SDK.

The separate Open Activity helper uses the same destination validation and
opening implementation. One installation handles both Primary and Secondary
Quick Launch mappings. Dashboard itself always opens normally and retains its
own card order. The [navigation design](activity-app-navigation-draft.md) defines
the Dynamic presentation handoff, automatic closure and current SDK limits.

## Host architecture and transport

One Dashboard-owned discovery and subscription layer serves readings, activities
and controls. Match subscriptions on exact provider/source, requested properties
and image needs. Share compatible reads; do not merge unrelated sources because
their display text matches. Activities remains independent of Core and Dashboard.

Keep these responsibilities separate:

| Layer | Responsibility |
| --- | --- |
| Provider plugin | Business data, stable instances, applicable commands |
| Activities helper | Semantic summary, optional links/bindings and source validation |
| Dashboard phone host | Saved configuration, catalogue, selection, subscriptions, action routing |
| Dashboard native app | Visible rows, detail, input, local clock ticking and feedback |

The ordinary-reading picker hides recognized `activity/summary` JSON and the
internal `@snapshot` record, along with recognized legacy activity items. It
offers a friendly Activities entry instead and prefers supported source versions.
Older ordinary plugins keep working. One plugin appears once in Add, with the
items/capabilities it actually exposes.
Built-in Music can use a trusted adapter over its actual `music/track` source;
it does not have to start publishing the new convention. Bind only actions
verified for the returned provider. An arbitrary music-like reading does not
automatically acquire playback commands.

Read action metadata from discovery, but request activity action descriptors only
for a selected interactive provider. The SDK returns an item's instances, so
requesting actions may fetch all sixteen of that provider's summaries, not just
one run. Share/adjust that subscription and release unneeded action properties
when the user leaves. Do not subscribe to every raw property or fetch full-size
artwork for all off-page cards.

Use a separate Dashboard profile instead of increasing Dynamic's two-card limit:

| Screen | Initial proposed bounds |
| --- | --- |
| Overview | Header 28px, four rows of 44px, footer 24px |
| Overview row | One 16px image/symbol, short context and one typed live value |
| Detail | One selected card, including optional 40px artwork |
| Action menu | Up to four readable rows per page; contextual list maximum three |
| Native catalogue | Current window only; full catalogue stays on the phone |

Text stays static and truncates at its end. User-driven list navigation is
allowed; it is not automatic text scrolling. Only visible clocks schedule ticks.
Row selection anchors to a stable row/occurrence key, not an array index.
An action-only row legitimately has no value datum. Do not represent missing
state as zero/false or manufacture an activity. If an essential value cannot fit
the overview, retain the configured row and offer Open details instead of a
misleading partial value; the source record itself remains valid.

A proposed overview frame can fit four rows in 1,496 bytes:
`24 + 4 × (64 metadata + 160 text + 16 palette + 128 pixels)`. Use a proposed
1,536-byte payload ceiling. A one-card detail from the Activity profile is at
most 1,348 bytes. An action menu carries short labels and tokens, not JSON args.
These are capacity allocations; exact layouts and codecs remain to be specified
and built. AppMessage dictionary overhead needs its own buffer allowance.

Overview, detail and menu are separate screens. A bounded union can reuse native
storage rather than retain several image-heavy snapshots. Preserve the host's
single AppMessage queue. Window messages carry session/sequence and explicit
window scope; omitted off-page rows are not source withdrawals.

Do not assume power, heap or executable size from Dynamic's audit. Measure the
Dashboard binary, initialized heap/stack, worst artwork/clock combinations and
repeated navigation. The proposed geometry is not a new native capture.

On disconnection, disable phone-routed actions and retain no private body cache.
An already received public clock can follow its explicit original lease policy.
Other pages cannot be manufactured from an absent phone catalogue. Back remains
available during loading, pending operations and errors.

## Add and selection flow

1. Open Add on the phone and choose one installed plugin.
2. Pick a friendly reading, Activities entry or advertised command.
3. For a reading, select the source instance/property and supported presentation.
4. Configure supported command arguments once; offer only real bindings.
5. Offer Show its active task when an explicit entity link can be matched.
6. Save the Dashboard-local card and its position.

The Live provider allowlist/order is configured separately inside Dashboard.
It does not change Dynamic's settings or remove source activities. Detail can
offer Pin this provider's activity view, Pin this entity where stable support
exists, or Hide this plugin's live activities. That hide persists the provider
UUID in Dashboard's automatic-Live allowlist settings; it does not remove saved
cards. Unpin separately removes the chosen configured card. Neither operation
cancels a job, acknowledges a result or changes Dynamic. Per-occurrence hiding
is not part of this initial configuration model.

## Initial implementation order and acceptance

First finish the new Activities source and Dynamic view integration against the
approved previews. Keep entity/action metadata optional so display-only hosts
pay no native action-storage cost.

Then implement Dashboard discovery, ordinary reading/control pins and activity
views with Music and Next Timer. Entity hybrids follow only where a provider
actually exposes a stable entity and relationship. Per-timer entity pins,
native Timer commands and arbitrary parameter forms are separate enhancements.

| Scenario | Required behavior |
| --- | --- |
| Reading-only plugin | Useful without Activities or actions |
| Action-only plugin | Command card without an invented task |
| Idle entity with a Start preset | Base state and explicitly configured command |
| Active linked task with Stop | Activity content and its advertised Stop |
| Active linked task without actions | Read-only; idle Start is not retained |
| Two tasks on one entity | Select in source order, keep others accessible |
| Different entities on one provider | Never merge by name or provider alone |
| Next Timer restarts | Selection follows a new occurrence without retaining old controls |
| Source removed while menu open | End/disable that occurrence, never act on its replacement |
| Hybrid task ends while Stop menu is open | End that view; restore idle Start only after returning to overview |
| Exact provider missing but SDK falls back | Pinned source remains unavailable |
| Unchanged temperature refresh | Control focus/token remains valid when its target is unchanged |
| Duplicate transport press | One invocation for the same request ID |
| Duplicate after recent-result eviction | Reject old request instead of invoking it again |
| Action timeout then reconnect | No replay; refresh and show actual state |
| Permission loss | Invalidate applicable tokens; SDK still enforces invocation |
| Activity array empty | Keep configured cards; retract automatic rows |
| Off-page records omitted from a window | Keep source catalogue intact |

## References

- [Core Activities draft](notification-activities-draft.md)
- [Concrete Dashboard scenarios](dashboard-integration-examples.json)
- [Official Pebble plugin model](https://developer.repebble.com/guides/plugins/preview/)
- [SDK action declarations](https://github.com/coredevices/mobileapp/blob/master/libpebble3/src/commonMain/kotlin/io/rebble/libpebblecommon/plugin/PluginManifest.kt)
- [SDK invocation handling](https://github.com/coredevices/mobileapp/blob/master/libpebble3/src/commonMain/kotlin/io/rebble/libpebblecommon/plugin/PluginClient.kt)
- [Android widgets and hybrid widgets](https://developer.android.com/develop/ui/views/appwidgets/overview)
- [Android device controls](https://developer.android.com/develop/ui/views/device-control)
