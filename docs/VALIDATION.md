# Validation

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
