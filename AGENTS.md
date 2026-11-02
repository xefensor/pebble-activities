# Pebble Activities maintainer notes

This package targets stock PebbleOS. It is a library and public provider
convention, not an installed background service. Keep it independent of
Pebble Watchface Core, Dynamic's renderer and any firmware fork.

## Boundaries

- `src/js/` supplies injected-host publisher, provider and consumer helpers.
- `include/` and `src/c/` supply portable bounded state and packet helpers.
- `examples/timer/` is a native timer watchapp with its own PKJS and plugin.
- `docs/SPECIFICATION.md` defines our versioned convention using existing Pebble
  property shapes. It is not an official Pebble standard.
- The host owns SDK subscriptions, AppMessage dispatch, clocks, timers and UI.
  Share its single queue; do not initialize competing dispatchers.

## Invariants

- Native timer state and its alarm remain authoritative when the phone is absent.
- Phone receipt means accepted shared state, not an alarm or a disk-flush guarantee.
- Preserve source/run identity, revisions and observation time. Polling a saved
  snapshot must not renew its native observation. Zero is not proof of completion.
- Provider discovery validates the actual returned UUID and handles removal,
  permissions and expiry. Unknown versions fail closed.
- Private music and notification data never enter persistent caches or logs.
- Keep existing music notification privacy/baseline behaviour when adapting it.
- Firmware-only native workout state and native cross-app sharing remain unsupported
  on the stock path. Never label fixtures as a live phone or physical-watch test.

## Verification and releases

Run meaningful portable JS/C tests and cross-language wire fixtures. Build SDK
packages and examples before claiming PBW compatibility. Verify native size and
affected layouts in actual emulator renders. Record hardware and real-phone checks
separately. Pin source versions/checksums in consumers and preserve published bytes.

This repository uses the accompanying PolyForm Noncommercial license and required
attribution. Preserve notices on copied or adapted code.
