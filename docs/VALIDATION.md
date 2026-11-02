# Validation

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
