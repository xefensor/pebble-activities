# Validation

## 0.4.4 activity correctness local candidate — 5 November 2026

The clean0.4.3 baseline is commit `fbd3ce42771a299e9ce79a23338ac254387f9d1b`.
Six new lifecycle regressions failed before the fixes; their failures are
recorded in `qa/0.4.4/regressions-before.log`. The candidate passes195 JavaScript
tests, all three strict portable C suites,23 Python release-helper tests and
the SDK4.33.1 Emery package build. Test/build evidence is in `qa/0.4.4/`.

Reproduced failures were dead failed handles surviving configuration/discovery,
an exact cached response leaving a fresh binding waiting with no activity,
partial rows of a rejected complete response poisoning valid owner history,
another plugin's malformed declaration hiding compatible providers, and a
synchronous unsubscribe callback re-publishing a disabled provider. Recovery
also works on the same SDK handle after a transient or permission error. Exact
summary duplicates apply changed outer availability, including a shortened
private-content deadline, without renewing owner metadata.

Failed bindings now retry through existing discovery/configuration, healthy
bindings remain subscribed, and waiting incarnation resets stay blocked on
their existing native-clear acknowledgement. Complete-response per-record
revision/order changes commit only after all rows validate. Callback generations
advance before unsubscribe. Tests retain immutable observation/revision checks,
expired-private clearing and stable primary/secondary order while one provider
fails and recovers alongside a healthy provider.

Schema4 explicit paused media previously compiled as active, losing its paused
state before rendering. It now uses the existing ACT3 paused byte. A new generated
fixture is decoded and selected as `PAV_PAUSED` by the actual portable C engine;
tests cover every playback enum. Stopped, buffering and unknown do not invent a
paused label or completion. Earlier wire fixture bytes are unchanged.

No public API or wire/schema redesign, native C implementation, legacy context
adapter, notification baseline, polling service or Timer publisher was changed.
This is portable/package evidence. Phone and physical-watch behavior require
separate app integration; no battery or hardware claim is made. The candidate
remains local until a separately authorized publication.

## 0.4.3 consumer reliability local candidate — 5 November 2026

Baseline `e4fedfc` passes 176 JavaScript tests and all three strict portable C
suites. The candidate passes 183 JavaScript tests, the same three C suites and
23 Python release-helper tests, and builds the SDK4.33.1 Emery package. Commands
used the workspace recovery environment because this sandbox's plain Node26
blocks the child-process calls used by existing bundle tests. Logs and the
deterministic work comparison are in `docs/qa/0.4.3/`.

The consumer now keeps an expiry callback when its absolute deadline is
unchanged. Source observations and validity remain untouched. Settings-only
configuration discovers provider changes without replacing healthy source
subscriptions. Known disabled providers are synchronously unsubscribed and
withdrawn before asynchronous discovery, whose response may be delayed or never
arrive; callbacks from the removed subscription cannot restore their content.
Explicit refresh and reconnection still rebind; the existing
legacy Music/phone heartbeat and notification baseline logic are unchanged.

Delivery callbacks carry a consumer lifecycle epoch and native session token.
An old queued result cannot schedule retries or acknowledge a reset after a
disconnect, disable, session change or stop. Reset-clear acknowledgements also
capture the exact provider subscription generation: an earlier empty view
queued before that reset cannot release its barrier. Bootstrap clears its
pending latch when disabled and can request a new session after re-enabling.
The consumer releases its retained public `view()` at those inactive lifecycle
boundaries; hosts remain responsible for copies they separately retained.

New regressions reproduce stale reset acknowledgements, reused native view
sequences, bootstrap disable/re-enable, retained private views, expiry timing
and healthy subscription reuse. Publisher write/readback, global revision
floors, native owner state, privacy, original leases and terminal tombstones
retain their existing tests. No C implementation, wire fixture, exported API or
provider schema changed.

`scripts/benchmark-consumer.cjs e4fedfc` runs both committed baseline and working
candidate in isolated module graphs with sixteen synthetic 40px records. Under
both default and custom selection:

| Workload | Baseline | Candidate |
| --- | ---: | ---: |
|20 unchanged source deliveries: expiry timer schedules/cancellations|20 /20|0 /0|
|20 unchanged settings updates: provider subscriptions|20|0|
|20 unchanged settings updates: timer schedules/cancellations|40 /40|20 /20|

The remaining settings-update timer work is periodic provider discovery.
JSON work counts are unchanged from0.4.2. The emitted native frames remain
byte-identical under both selectors, SHA-256
`a8b8aa567caaa9a8a701b00f7b43a4ab3469e64bf8744afcde49d54d1ba668bd`.
These counts do not measure phone runtime, heap, physical-watch power or battery
life. No real-phone or physical-watch validation was performed in this library
pass. Consumer pins and installed PBWs are separate app work. This candidate
remains local and published release bytes are preserved.

## Publication — 3 November 2026

The [0.4.2 development prerelease](https://github.com/xefensor/pebble-activities/releases/tag/v0.4.2)
was published from tested source
[`45e848d7ef84044b465fddc43eeab310bb2c2594`](https://github.com/xefensor/pebble-activities/tree/45e848d7ef84044b465fddc43eeab310bb2c2594).
The documentation follow-up preserves the tag, SDK package, tarball and checksums.
For a repeated release check, pass that tested commit with `prepare --commit`;
the historical validation below retains its original scope.

## 0.4.2 consumer optimization local candidate — 3 November 2026

176 JavaScript tests, all three strict portable C suites and 23 Python
release-helper tests pass. The official SDK4.33.1 Emery library builds.
No native C source, wire fixture or public provider schema changed.
New regressions exercise mutations of nested artwork/source fields through
acceptance, selection, presentation callbacks and returned snapshots. They also
verify that the supported `pebble-activities/host` entry does not load the
publisher/storage bridge, while the complete root API remains available.

The consumer indexes provider metadata once per discovery, avoids copying all
cards to calculate a status count, removes the second public-catalogue clone,
and retains its already-owned normalized presentation instead of cloning it
again. Source fingerprints use shallow descriptor copies; source artwork is
serialized once without being copied/parsed. Availability expiry compares
explicit removal/confirmation changes instead of serializing complete cards.
All acceptance callbacks now receive defensive copies. Custom selection and
presentation callbacks, and all public reads, retain defensive nested copies.
Both public normalization boundaries remain in place: host selection is
untrusted input, and the public encoder must validate arbitrary callers.

`scripts/benchmark-consumer.cjs 0c3b6a47b497308c15b851ce7d0e69499cdf79e7`
counts JSON calls and UTF-16 characters for sixteen records with40px images.
It loads the baseline and candidate in isolated VM module graphs without
modifying either checkout, and asserts byte-identical emitted native frames
under both selection policies. The recorded comparison is in
`qa/0.4.2/consumer-json-work.json`:

| Workload | Baseline JSON parse/stringify characters | Candidate characters |
| --- | ---: | ---: |
|100 status reads|3,478,000 /3,478,000|0 /0|
|20 public catalogue reads|1,399,540 /1,399,540|695,600 /695,600|
|20 default forced projections|869,688 /955,988|87,788 /174,088|
|20 custom-selection forced projections|869,688 /955,988|783,388 /869,688|
|20 duplicate source deliveries with custom selection|1,385,760 /2,170,540|695,600 /1,480,380|

This is deterministic serialization work, not elapsed phone time, heap usage,
watch CPU profiling or battery evidence. There is no new persistent content
cache, timer or protocol. Incarnation, immutable revision/fingerprint checks,
original observation/expiry, private clearing, capabilities and retry limits
retain their existing coverage. Historical releases remain unchanged; this
candidate is local until separately published. Test/build logs are in
`docs/qa/0.4.2/` and final package hashes are in `releases/SHA256SUMS.txt`.

## 0.4.1 GitHub prerelease publication — 3 November 2026

Published as a [GitHub development prerelease](https://github.com/xefensor/pebble-activities/releases/tag/v0.4.1)
from commit `769eabc4b2bb4242a0f2d81ed3575c459d373a4a`.
Both branch checks and the release check/publication jobs pass. All three
published assets were downloaded and match the prepared bytes:

- `dist.zip`: `d198a3a066552590dcedb4fa580216b067beb088752d2efd050029ed1bef28ad`
- `pebble-activities-0.4.1.tgz`: `c292bbe7ac4aca6c75cebc6fe559cebbc722da072ff90fda085315e72369735b`
- `SHA256SUMS.txt`: `2f6c6b3acfac7da5d60d54c93c2790ce1b854e0cd050e091c17e835bd736570f`

This documentation follow-up preserves the tested source commit, published tag
and assets. The release configuration pins 0.4.1 to that source snapshot;
future versions use their own release commit. Older tags and assets are unchanged.

## 0.4.1 canonical notification activity

The context adapter supplies a normalized ACT3 standard notification card with
source UUID, private sender/body, app identity/icon, stock Notifications destination
and stable host preference key. New regressions cover baseline ACK gating,
immutable polling, all privacy modes, same-occurrence revision changes, late
icons, coalescing, redaction recovery, clear/error/settings/disconnect/API lifecycle,
and the opt-in 13-byte sidecar carrying the original event deadline. Shortened
source leases cap both visible and queued records in legacy and activity modes.
The default legacy transport remains covered by all existing context tests.

171 JavaScript tests, three strict portable C suites and 23 Python release-helper
tests pass. ACT3 fixtures and wire bounds remain unchanged. The SDK4.33.1 Emery
library builds; the versioned npm archive includes the matching SDK, source and
documentation. Release preparation validates every packed file against the local
source commit. The0.4.0 archive retains SHA256
`9e640aea91d08633e91e59dab3d1e0ee6243efe0109d971e42d356a4d67affbe`.
Rendering, vibration/Quick Launch timing on actual phones and physical watch
behavior remain consuming-app/device checks.

## 0.4.0 semantic summary and ACT3 local candidate

161 JavaScript tests and three strict portable C suites pass, including the
ACT3 cross-language fixtures, maximum2672-byte frame, malformed-packet bounds,
independent clocks and private clearing. The SDK4.33.1 Emery library builds.
New tests cover all20 approved content examples and eight deliberate rejections,
managed cold requests without private-content storage, counted empty responses,
Timer owner leases and hidden acknowledgements, optional capabilities, metadata
incarnation rebinding, old-callback rejection and frozen navigation projection.

These are library/portable checks. Dynamic rendering, the actual mobile plugin
runtime, Quick Launch transitions, physical-watch heap/stack/battery and native
presentation ACK ordering require their consuming app evidence. No Dashboard
implementation or forked phone/firmware is included.

## 0.3.0 simple activity contract — 3 November 2026

The current plugin API is `activity/live` schema 3: one content item, optional
detail and an optional image. The public API has no mandatory field labels,
main/support trees, meters or host layout selection. Normal/compact presentation
belongs to consumers. Existing schema 1/2 and ACT1/ACT2 remain compatible.

**141 JavaScript tests, two strict native C suites and 23 Python release-helper
regressions pass**, together with the SDK 4.33.1 Emery package build. New tests
cover public text/value/countdown/elapsed helpers, strict bounded descriptors,
source3 serialization, native provider compatibility, discovery preferring
live over card/session, immutable source revisions, original observations,
privacy, hidden terminal results and independently running detail clocks.
A new schema3 projection is decoded and ticked by the production C implementation.
No C library source or native packet format changes are required.

Music is adapted through the same simple API. A regression reproduces the
reported long-title/missing-artist source, checks implicit identity labels,
omits optional '?' artist data, preserves observation on polling and clears on
disconnection. The source SDK callback is also used by Dynamic's native fixture
producer; its own release evidence covers the rendered normal/compact views.

The Timer native bridge opts into the new source while retaining session/card
compatibility. Original paused visibility, acknowledgement, terminal tombstones
and source observation/expiry remain authoritative. Real mobile-app provider
delivery and physical-watch behavior remain separate device checks. Earlier
published tags and artifacts remain unchanged.

## 0.2.2 provider selection and transient music bridge — 3 November 2026

Portable checks pass: **129 JavaScript tests, two strict native C suites and
23 Python release-helper tests**. The SDK 4.33.1 Emery library build passes.
The new selector covers provider order, hidden/unknown providers, terminal
fallback, stable equal deadlines and independently running timers. Installed
idle providers retain validated UUIDs and friendly metadata outside source
fingerprints. The metadata name field is verified against the official
plugin-test example linked in the view specification.

The opt-in music bridge covers source UUID validation, callback-owned revisions,
unchanged observation/expiry on repeated projection, pause/expiry, disconnection
and opt-out. Default music and notification adapter tests remain enabled,
including notification baseline/privacy and malformed-source behavior. Private
music is transient and never enters settings or cache storage. ACT1/ACT2 formats
and native library sources are unchanged. The bounded selector owns no storage;
Dynamic keeps its own provider preferences.

Dynamic records its own renderer and real-Clay integration evidence. These
library checks do not claim a physical-watch or real-phone transport result.
Published 0.2.1 and earlier release bytes and tags remain unchanged.

## 0.2.1 acknowledged results and compact Timer projection

Published as a GitHub development prerelease from
`d2251a1e4e3d8543ad2e8be01fccc8758e785fb6`. Both implementation workflows passed;
all three downloaded assets match the prepared bytes and SHA-256 checksums.
Later publication documentation does not replace the frozen SDK or npm package.

Portable validation passes: 122 JavaScript tests, two native C suites and
23 Python release-helper tests. New cases cover acknowledged completion through
the provider/consumer, cold reload, stale/conflicting visibility metadata,
privacy and compact Timer projection without altering detailed/default sources.
An SDK 4.33.1 Emery package build also passes. The native wire format and native
library sources are unchanged. No live-phone
or physical-watch validation is claimed; Timer and Dynamic record their own
consumer/build evidence.

## 0.2.0 GitHub prerelease publication — 2 November 2026

Version 0.2.0 was published from commit
`af6c48f727c33cd16ded003347a7a4639fd99901`. Both GitHub workflows passed.
All three published assets were downloaded and match the prepared files and
checksums. The ACT2 validation below describes those exact runtime/SDK bytes;
publication-status documentation updates do not replace the frozen artifacts.

## Local CLI recovery — 2 November 2026

GitHub `main` and v0.1.2 were checked at
`baac66dc88a6be6062dc8fe57156fdb96007b3c7`. Applying the supplied patch
to its documented base reproduced all 61 manifest-listed files and exactly the
already-published Git tree. The local `recovery/0.1.2-2026-11-02` branch therefore
reuses that commit rather than duplicating or republishing the library changes.

Fresh checks pass: `npm ci --ignore-scripts`, 102 JavaScript tests, the strict
native C suite, 23 Python release-helper tests, and an SDK 4.33.1 Emery library
build. The sandbox's captured subprocess restriction required a local Node
runner adapter using temporary files and `--test-isolation=none`; assertions
and production code were unchanged. The rebuilt SDK archive was saved separately
in the common recovery workspace, and the published `dist.zip` bytes restored.
All released tarballs remain unchanged, including the exact 0.1.2 archive pinned
in both consumers. This documentation checkpoint does not require a new release.

Fresh Timer/Dynamic integration evidence belongs to their recovery branches.
There is no new physical-watch or real-phone verification for this library.

## 0.1.2 bounded multi-record publishing

- 102 JavaScript tests and the strict native C decode/state/clock/publisher suite
  pass. Eleven new publisher cases cover eight independent slots, legacy migration,
  cold reload, independent pause/cancel/expiry, offline slot reuse, revision and
  terminal replay rejection, bounds, capacity-reduction rejection, write/readback
  failures and privacy redaction.
- The 23 release/packaging regression tests pass.
- The SDK package builds with the installed official SDK 4.33.1 for Emery.
- Public `activity/session` properties and ACT1 are unchanged. The native wire
  still projects at most two activities; providers may expose up to eight saved
  records, and consuming hosts select the appropriate projection.
- This library change has no new real-phone, physical-watch or emulator result.
  Consumer and Timer integration checks belong to their release evidence.

## 0.1.1 standalone-library packaging

Timer now lives in [pebble-app-timer](https://github.com/xefensor/pebble-app-timer).
This release changes repository ownership, documentation and packaging; the
activity protocol and JS/C runtime sources are unchanged from 0.1.0. The library
build and release no longer require Timer source or a Timer PBW.

- The 91 JavaScript tests and strict native C decode/state/clock/publisher suite pass.
- Library-only packaging and release-helper regression tests pass, including
  packaging without a Timer checkout and preserving historical download bytes.
- The SDK package builds with the installed official SDK 4.33.1 for Emery.
- No new phone, physical-watch or emulator integration run is claimed for this
  packaging-only change. The 0.1.0 evidence below remains historical evidence.

## 0.1.0 stock PebbleOS prerelease

This release targets Emery (Pebble Time 2), built with the official SDK 4.33.1.
It uses stock PebbleOS, with no firmware or mobile-app fork.

- 91 JavaScript tests and the strict native C decode/state/clock/publisher suite
  pass, including JS-to-C fixtures, malformed packets, sessions, revisions,
  terminal tombstones, expiry, privacy and original observation times.
- Native C also passes AddressSanitizer/UndefinedBehaviorSanitizer; LeakSanitizer
  is disabled because this environment does not support its process inspection.
- The reference timer passes its portable model suite and four PKJS/storage/cold
  plugin handoff tests. The actual packaged PKJS and plugin also pass the bundled
  receipt/provider smoke check. Release-helper regression tests pass separately.
- The library and reference timer build with the SDK. Timer resources are 4,092
  bytes; its reported footprint is 7,720 bytes, leaving 123,352 bytes before startup.
- Actual native QEMU renders and the pypkjs simulated phone demonstrate the timer's
  accepted-revision receipt, shared storage, independently called provider,
  automatic discovery in Dynamic 0.7.0, local countdown, paused value and
  cancellation restoring music. Normal button navigation completes these
  roundtrips. Recorded timer exits release all allocated heap.
- Disconnecting clears music while retaining an explicitly last-reported public
  timer through its original validity. The consumer can reach zero without
  receiving completion; that is deliberately not an alarm acknowledgement.

See [handoff evidence](qa/0.1.0/handoff.json) and the accompanying untouched
200×228 Screenshot-service images. This is an emulated phone integration test,
not a real Android/iPhone app or physical-watch test.

## Remaining checks

Native Wakeup scheduling and error handling are implemented in the timer; no
phone schedules its alarm. A clean emulator run confirms the scheduled Wakeup survives
closing the app with Bluetooth disconnected, launches at the exact deadline with
APP_LAUNCH_WAKEUP and completes the timer. A diagnostic build adds logs only;
see [alarm evidence](qa/0.1.0/alarm.json). The final normal PBW also passes a second
one-minute offline cold-launch test: the app was left 58 seconds before its
deadline and no manual launch followed. Production init explicitly handles a
matching cold Wakeup before ordinary restore. Physical-device verification of alarm
delivery, vibration, RTC changes, reboot and power use remains required. The reference
timer is a development example, not a production alarm certification.

A system watchdog dialog occurred during repeated forced developer AppRunState
launch commands. Later normal button roundtrips passed. Forced-launch stress is
not certified; this is recorded rather than attributed to an unproven cause.

Real mobile-app provider discovery, permission removal, disconnected publishing
and reconnect timing still need device testing. The portable suites cover those
state transitions with injected host APIs; they do not substitute for a real
mobile-app test. Native Workout sessions and fully watch-local cross-app sharing
remain unavailable through the public stock SDK.
# 0.2.0 ACT2 candidate validation

On 2 November 2026 the feature branch passed 119 JavaScript tests, both portable
native suites and 23 Python release-helper tests. Cross-language fixtures include
two independent clocks, a value/meter/artwork card, a bounded terminal result and
the exact 2,672-byte maximum frame with two full images. Decoder tests cover
malformed/truncated input, UTF-8, sessions and view sequences, immutable source
metadata, per-item retention/expiry and terminal no-resurrection rules.

The native view allocation is 1,324 bytes per card and 2,676 bytes per state on
ARM. The isolated new codec compiles warning-free; compiler stack reports use
160 bytes for `pav_decode` and 72 for `pav_state_receive`, excluding their callees.
The legacy decoder now clears public non-clock content on disconnect, matching
the existing specification; a native regression covers that case.

SDK 4.33.1 successfully built the combined library package. This is library
validation, not a consuming app's RAM, code-size or physical-watch measurement.
Dynamic and Timer must build and validate their own pinned candidates. Tests
and builds here do not establish real-phone delivery, hardware alarms or power.
