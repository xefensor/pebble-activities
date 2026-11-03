# Activity app navigation draft

**Status: design proposal, 3 November 2026.** Use one installed **Open Activity**
watchapp for both Dynamic activity positions. Dashboard stays a separate app.
The helper automatically opens the selected activity's associated watchapp and
closes when resolution fails. This specifies the behavior and a proposed
handoff; it does not implement or validate an app launch.

**Current scope: stock PebbleOS and the official phone app.** No firmware fork,
phone-app fork or custom mobile build is a dependency. Evaluate the existing-SDK
handoff with its documented origin/cancellation limits. Host API additions below
are future possibilities only; they are not part of the current work. This scope
does not imply that the proposed metadata retention or prototype behavior has
already been accepted or physically tested.

## Shortcut settings

Assign **Open Activity** to the desired buttons in Pebble's Quick Launch
settings. Its own settings choose what each shortcut means:

| Setting | Initial value | Choices |
| --- | --- | --- |
| Hold Up | Secondary | Default, Primary, Secondary |
| Hold Down | Primary | Default, Primary, Secondary |
| Default activity | Primary | Primary, Secondary |

The first interface exposes these two hold overrides. Other supported hold
buttons use Default. Both OS assignments have the same name, Open Activity.
Changing a role in the helper's settings does not change global OS assignments.
Instructions should describe those two operations separately.

Identify a shortcut by launch reason, action and button together. In particular,
an app-menu launch can also have a button ID; that is not a Quick Launch hold.
Support verified hold launches first. Unknown launch reasons and unimplemented
tap/combo modes close. Opening the helper from the ordinary app menu also closes;
its initial purpose is the shortcut, and configuration is on the phone.
Missing overrides use the valid default; malformed saved settings close rather
than selecting an unintended activity. Factory defaults are compiled values,
not a recovery interpretation of corrupt configuration.

Primary and Secondary refer to the positions Dynamic actually presented. They
are not plugin types or a second priority list. If Secondary is absent, close;
do not substitute Primary. A Timer primary and Music secondary therefore open
Timer on Hold Down and Music controls on Hold Up. If those positions swap,
the same shortcuts follow the new positions.

## Visible behavior

The helper has one static Opening… view while it waits. A public destination
app name can replace the generic wording once known. Do not fetch track titles,
notification text or artwork for this view. It needs no scrolling, continuous
animation, vibration or success screen.

Start a native timeout immediately on launch, including phone startup time.
Use **four seconds as an initial prototype budget**, not a measured guarantee.
Close sooner for a missing selected position, missing destination, disconnection,
invalid context, permission refusal or a resolution error. Back is available
throughout. An unavailable secondary does not open a chooser or Dashboard.

On success the destination app replaces the helper. Do not subsequently send
a return-to-watchface command from the helper's deinitialization. On failure,
remove the helper's windows and allow normal system return behavior. Verify
the Quick Launch return path on the watch; app-menu closure can have a different
system destination.

## One optional app destination

Add a navigation capability independent of summary content and contextual
action buttons:

```ts
type OpenAppDestination = {
  watchAppUuid: string; // Canonical, nonzero watchapp UUID
};

// Optional Shared author field in the proposed summary contract:
openApp?: OpenAppDestination;
```

The first version accepts this one key only. No action name, script, phone URL,
arbitrary launch arguments or implicit provider-to-watchapp conversion is allowed.
An installed phone plugin and a native watchapp have different identities.
Providers can publish the same destination for every occurrence or different
destinations where that association is real.

Serialize `openApp` as optional `open_app`, a declared SDK `longText` containing
at most 96 UTF-8 bytes of JSON. Keep it outside the 1,024-byte summary content
descriptor and outside the three contextual action slots. Interested consumers
request it explicitly. Producer helpers reject invalid authored destinations;
consumers discard malformed optional navigation while retaining valid content
and independently valid actions.

Known host adapters can supply verified destinations for built-in sources:

| Activity | Watchapp | Destination UUID |
| --- | --- | --- |
| Our Timer | Timer | `50e9ef12-a5ab-4369-a3b5-3447bfba5151` |
| Built-in media source | Music controls | `1f03293d-47af-4f28-b960-f2b02a6dd757` |
| Built-in notification source | Notifications history | `b2cae818-10f8-46df-ad2b-98ad2254a3c1` |

A third-party activity has no destination until its provider or an explicit
host binding supplies one. Never infer it from a label, icon, activity type or
matching UUID. Opening Notifications does not select the displayed notification;
opening Timer does not select the displayed timer. Exact occurrence navigation
needs a separate destination-app protocol.

Dashboard uses this same destination and opening implementation. Its overview
Select still opens the selected card's detail. Open app is explicit navigation
in that detail/menu, alongside up to three contextual controls. It does not
consume a Pause/Next slot or replace those operations. Ordinary reading cards
can use an explicit host-owned destination binding too; a generic plugin/entity
navigation-discovery convention and a watchapp picker are not supplied by the
current Activities contract.

## Dynamic presentation handoff

The launcher must not independently rank all current activities. That could
open another provider when a source changes, a secondary is omitted for space,
or native promotes it after expiry. It needs the recent pair actually presented
by Dynamic, including the selected role's validated destination.

Dynamic native reports a presentation status tied to a known native session
and view sequence, with a monotonically increasing presentation sequence and
the original record indices occupying each visible position. An absent position
is explicit. Report after applying the view and determining visible content;
a transport ACK alone does not establish presentation. Report changes caused
by local expiry, promotion, privacy clearing and temporary visibility changes.

Dynamic PKJS resolves those indices against that exact view's transient source
records. It creates a hint only from a recognized presentation status. A status
from an older session/view/presentation must not restore an older pair. On
observing a new Dynamic native session, invalidate the previous hint until a
new status arrives; an unreported reboot cannot immediately clear phone storage.
Clear before processing replacement content; do not preserve an older openable
route when its replacement has no destination.

Freeze each view's destination mapping instead of resolving an old index through
mutated current source objects. An `open_app` change or withdrawal clears the
old hint and requires a new view sequence and native presentation confirmation,
even if every drawn pixel would stay the same. This changes presentation
metadata, not the owner's business revision.

No app UUIDs or action arguments need to be added to the 2,672-byte proposed
ACT3 display packet. This needs a small status side channel and a phone-side
mapping for the view being confirmed. Append new Dynamic message keys, preserve
its single queue and measure native code/heap costs; the current released
binary's 627-byte virtual-size headroom does not establish that it fits.

### Current SDK handoff constraint

Dynamic currently has no exported navigation source. The SDK starts a plugin
JavaScript context afresh for each source/action request and tears it down
afterward. Module variables cannot carry a pair across app switches. Retained
source subscriptions do not turn PKJS globals into cross-app memory.
PKJS and the same PBW's plugin share UUID-scoped **persistent** localStorage.
These are verified execution properties, not an existing navigation service.

Proposed source: category `navigation`, item `presented_activities`, one stable
instance `current`, property `hint` as `longText` JSON capped at 512 UTF-8 bytes.
The helper uses a bounded one-result subscription with the exact Dynamic UUID,
then unsubscribes. Source validity cannot exceed the stored hint's expiry.
Reject unknown fields/versions, noncanonical UUIDs, invalid sequence integers
and invalid timestamps. A missing/expired hint has no usable current instance.

There are two implementation paths:

| Path | Requirement | Retention |
| --- | --- | --- |
| Stock SDK prototype in current scope | New read-only Dynamic plugin source backed by one bounded localStorage hint | Retains recent destination metadata on the phone |
| Future phone-host memory handoff outside current scope | New host facility with origin/watch identity and expiry | Routing data can remain transient |

The stock proposal stores only schema, Dynamic UUID, native session, view and
presentation sequences, presentation/expiry timestamps and two destination
watchapp UUIDs or null. It stores no provider or occurrence IDs, notification
contents, titles, artist names, artwork, action arguments or content fingerprints.
Keep one record, not a history. The fixture shows its intended shape.

This record still reveals recent app destinations. Calling it entirely
transient would be wrong. Treat this as a proposed navigation-metadata retention
decision before implementation; it does not waive the existing prohibition on
persistent private music/notification content. If that prohibition includes all
usage metadata, use the host-memory path or leave the affected route unavailable.
Do not silently persist private identifiers to make matching easier.

Use a proposed maximum routing lease of **45 seconds**, capped by the earliest
known event that could change a visible position, including its existing source
or business expiry. Renew only after another native presentation status. Source
reads preserve the original expiry and cannot renew the hint. Delete invalid or
expired stored hints on access; clearing on known native/privacy/disconnect
events is also best effort. Expiry rejects use even if physical deletion has not
yet run.

A stable face still needs a recent confirmation. The prototype must establish
whether existing refresh traffic can request that status frequently enough.
If it cannot, an explicit low-frequency status request has a power cost that
must be measured. Do not promise reliable idle-time launching while declining
all hints after 45 seconds and providing no way to renew them. Per-second
heartbeats, storage writes on clock ticks and full-frame retransmission solely
for navigation are excluded.

The read-only source is owned by Dynamic; the helper cannot write it. Request
it using Dynamic's exact UUID and verify the returned provider UUID, schema,
bounded JSON and timestamps. Define the source's caller permissions and audit
any SDK permission propagation from Dynamic's existing data access. A public
destination ID is not a reason to bypass source permissions.

### What this hint cannot prove

The current Watch State plugin exposes no read source proving the immediately
preceding watchface. A recent Dynamic hint can survive a switch to another face.
Session/sequence values prevent rollback within the writer; they do not give
the helper independent proof of which face preceded it. Strict Dynamic-origin
checking needs a host/OS capability. The stock prototype must expose this
limitation rather than claim it can always detect another face.

The hint also cannot prove that an occurrence still exists after an unreported
native acknowledgement or deletion. With occurrence IDs deliberately absent,
it is only permission to attempt opening an app recently associated with a
visible position. It never authorizes a timer command, notification dismissal
or operation on an exact run. A fresh provider read cannot reconstruct proof
of the previously displayed position.

### Future host integration outside current scope

Reliable origin checking could use a narrow navigation addition to the phone
host, if it becomes available through the official app in future. Its existing
per-watch AppRunStateService already tracks runningApp and
previousApp, retaining the last started app across Stop-before-Start messages.
The public Watch State plugin does not expose that context today.

Dynamic would report its confirmed destinations to host RAM, scoped to watch,
connection, native session and presentation sequence. When the host observes
Open Activity starting immediately after Dynamic, it freezes a fresh one-use
handoff for that exact transition. An unknown predecessor, missing/expired pair,
reconnection or another intervening app cannot create a usable handoff.
If the helper's request precedes the app-start event, wait only within the
bounded attempt; do not infer the transition from a cached last-known UUID.

The helper requests Primary or Secondary. After permission handling, the host
checks that the same helper launch is still current, its handoff remains fresh
and unconsumed, and the selected destination exists. It consumes the handoff
and launches only on the associated watch. Rejected/missing data closes the
helper. No disk-backed navigation record is necessary for this host path.

Use a new guarded action/capability with explicit launch-context semantics;
unsupported hosts must reject it. Do not add guard arguments to the old
`launch_app` call and assume an older implementation enforces them. A host
guard still cannot recall a command already sent to the watch. Atomic rejection
after the user leaves would additionally need a watch-side conditional-launch
or deadline capability.

This is a proposed phone-app integration, not a third-party JavaScript plugin
or an API our current helper can call. A final Dynamic exit message and a short
one-use stored ticket can be explored on the current SDK, but remain best effort:
Dynamic also exits for other apps/faces, and final AppMessage delivery can race
shutdown. They do not establish reliable origin checking by themselves.

## One opening attempt

1. Native recognizes a supported shortcut, chooses its configured role, creates
   a fresh request session and starts its timeout.
2. Phone reads the exact Dynamic navigation source and validates the hint.
   Missing selected destination is a failure, including a missing secondary.
3. Phone checks bounds/expiry and rejects the helper itself as a destination.
   A new native session/attempt discards older callbacks.
4. Before dispatch, phone sends the resolved destination identity back to the
   helper. Native confirms this exact attempt is still open and within its
   timeout. If it has closed, do not begin an app launch.
5. Phone rechecks expiry and dispatches exactly one SDK invocation. Duplicate
   confirmations do not invoke twice. No automatic retry or reconnect replay.
6. A pre-dispatch error closes the helper. Success allows the destination to
   replace it. A timeout can close the helper even when an already submitted
   launch has an unknown outcome.

The destination operation is host-owned navigation through Watch State:

```js
Pebble.invokeAction({
  plugin: '00000000-0000-0000-0001-000000000007',
  action: 'launch_app',
  args: {uuid: destination.watchAppUuid}
});
```

That is a proposed call site, not a request made by this draft. Watch State
validates the UUID against the locker/system shortcuts and requires LaunchApps.
Declare and obtain the necessary grants during setup so repeated use can be
one hold. A denied or
unresolved permission makes the attempt unavailable; a native timeout alone
does not cancel a phone permission request.

The current API has no cancellation token, server-side request deadline,
confirmation that the destination's pixels were drawn, or per-watch target.
Its underlying launchApp sends Start and waits until the phone observes the
destination UUID as running. Thus success is stronger than submission alone,
while failure/timeout still cannot prove the app did not launch. It currently
launches on every connected watch, so the first supported profile must be single-watch unless
that API changes. This is a supported-use restriction: the shown API cannot
count/select connected watches, and the helper cannot currently promise to
detect and refuse a multiple-watch setup. Do not treat an SDK error/timeout as
proof that no switch can still occur.

The final native confirmation reduces late requests; it is not an atomic
cancel-or-launch transaction. Back/timeout can discard work before dispatch.
After dispatch, neither native closure nor a JavaScript timer guarantees recall.
Permission handling happens before the action execution timeout in the current
client, making late permission approval another case to exercise. Never set a
return-to-face exit reason unconditionally during deinitialization, where it
could compete with the intended destination.

## Prototype and acceptance

First prove the Dynamic-to-helper handoff with one public Timer destination,
then both roles and native promotion. Add media/notification adapters only with
the chosen retention and permission policy. Keep this separate from production
Activities/Timer lifecycle changes; the native Timer alarm remains authoritative.

| Scenario | Required behavior |
| --- | --- |
| Up and Down assigned to the same helper | Independent configured role selection |
| Roles swapped in settings | Buttons follow the new mappings |
| Timer primary, Music secondary | Down opens Timer; Up opens Music |
| Secondary absent or omitted by layout | Secondary shortcut closes; no Primary fallback |
| Both activities open the same app | Both shortcuts can open that app without pretending to select a run |
| Source has no destination or invalid optional destination | Readable card; launcher closes |
| Native secondary promotes after primary expiry | New presented pair controls the routes |
| Promotion update missing | Old hint expires at the role-changing deadline; no re-ranking |
| Phone ranking changes before native presentation | Old displayed pair remains authoritative within its lease |
| Destination changes without visible content changing | Clear old hint; require a new confirmed view mapping |
| New Dynamic native session, old phone callback | Old session cannot restore a hint |
| App-menu launch or unsupported gesture | Helper closes |
| Phone absent, request fails or permission refused | Helper closes within the native UI budget |
| Back before dispatch or late source response | No new invocation for that closed attempt |
| Duplicate confirmation or reconnect | No duplicate/replayed invocation |
| Back/timeout after dispatch | Close UI; characterize possible delayed launch, no cancellation guarantee |
| Permission approved after native timeout | Exercise and document current late-dispatch behavior |
| Stable face remains unchanged for several minutes | Status renewal remains usable within measured power budget |
| Another watchface follows Dynamic | Exercise and document the stock origin limitation; do not claim a guard |
| Multiple connected watches | Unsupported first profile; no per-watch claim |
| Expired hint remains on disk | Reject it and remove it on access |
| Private content appears in storage/logs | Reject the implementation |
| Dashboard Open app | Same destination validation, independent of Dynamic's role order |
| Real watch repeated launches | Measure startup latency, visible flash, return path and memory |

The remaining production gates are the retention decision, acceptance of the
stock origin limitation, idle status renewal, actual permission/runtime
cancellation behavior, and native binary/heap/physical-watch results.
Production support depends on those platform results as well as the proposed
interaction.

## References

- [Activities content proposal](notification-activities-draft.md)
- [Dashboard integration proposal](dashboard-integration-draft.md)
- [Navigation and shortcut scenarios](activity-app-navigation-examples.json)
- [Launch reason and originating button](https://developer.repebble.com/docs/c/Foundation/Launch_Reason/)
- [Quick Launch per-button preferences](https://github.com/coredevices/PebbleOS/blob/main/fw/shell/normal/prefs.c)
- [Quick Launch app selection](https://github.com/coredevices/PebbleOS/blob/main/fw/apps/system/settings/quick_launch_app_menu.c)
- [Automatic closure through the window stack](https://developer.repebble.com/docs/c/User_Interface/Window_Stack/)
- [Current JavaScript plugin lifecycle and shared storage](https://github.com/coredevices/mobileapp/blob/master/libpebble3/src/commonMain/kotlin/io/rebble/libpebblecommon/plugin/JsPlugin.kt)
- [Watch State app launching](https://github.com/coredevices/mobileapp/blob/master/libpebble3/src/commonMain/kotlin/io/rebble/libpebblecommon/plugin/WatchStatePlugin.kt)
- [Per-watch running/previous app tracking and launch acknowledgement](https://github.com/coredevices/mobileapp/blob/master/libpebble3/src/commonMain/kotlin/io/rebble/libpebblecommon/services/app/AppRunStateService.kt)
- [SDK permission and invocation handling](https://github.com/coredevices/mobileapp/blob/master/libpebble3/src/commonMain/kotlin/io/rebble/libpebblecommon/plugin/PluginClient.kt)
