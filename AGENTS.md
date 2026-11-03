# Pebble Activities maintainer notes

This package targets stock PebbleOS. It is a library and public provider
convention, not an installed background service. Keep it independent of
Pebble Watchface Core, Dynamic's renderer and any firmware fork.

## Boundaries

- `src/js/` supplies injected-host publisher, provider and consumer helpers.
- `include/` and `src/c/` supply portable bounded state and packet helpers.
- The native Timer watchapp, its PKJS and its provider plugin live separately in
  `xefensor/pebble-app-timer`. This repository builds the shared library only.
- `docs/SPECIFICATION.md` defines our versioned convention using existing Pebble
  property shapes. It is not an official Pebble standard.
- `docs/SUMMARY-SPECIFICATION.md` defines schema4 standard/media summaries and ACT3.
  Prefer `summary` authoring for new providers; nativeFormat3 consumes summary first.
  Managed helper storage contains only incarnation/sequence; imported owners keep
  original revision/observation/validity and acknowledgement history.
- `docs/ACTIVITY-SPECIFICATION.md` preserves the simple schema 3 activity API:
  content, optional detail/image, app identity and source lifecycle. Plugins never
  choose normal/compact layouts or publish mandatory labels/meters.
- `docs/VIEW-SPECIFICATION.md` preserves advanced schema 2 cards and ACT2 native views.
  Preserve schema 1/ACT1 APIs and default behavior when maintaining them. Source
  revisions stay immutable; only native presentation changes use view sequences.
  Keep the internal view bounded, per-item clocks independent and private
  content transient. Visibility of terminal results requires explicit opt-in.
- The host owns SDK subscriptions, AppMessage dispatch, clocks, timers and UI.
  Share its single queue; do not initialize competing dispatchers.
- Read-only hosts may use `pebble-activities/host` to omit the publisher/storage
  bridge. Preserve the complete root API. Internal borrowed cards never escape:
  public reads and host callbacks own their nested data; both normalization
  boundaries still validate user projections and arbitrary encoder calls.

## Invariants

- Native timer state and its alarm remain authoritative when the phone is absent.
- Phone receipt means accepted shared state, not an alarm or a disk-flush guarantee.
- A host may opt into at most eight stable publisher slots. Slot zero is the
  legacy record; a source-wide revision floor applies across every slot. Slot
  reuse replaces only its prior run and must not evict another active record.
- Preserve source/run identity, revisions and observation time. Polling a saved
  snapshot must not renew its native observation. Zero is not proof of completion.
- Provider discovery validates the actual returned UUID and handles removal,
  permissions and expiry. Unknown versions fail closed.
- Private music and notification data never enter persistent caches or logs.
- Keep existing music notification privacy/baseline behaviour when adapting it.
- `createContext({notificationAsActivity:true})` emits a canonical ACT3 notification
  through `notificationActivity()` and suppresses legacy notice slots. Preserve
  source expiry for visible and queued records, the baseline-ACK gate, transient
  occurrence/revision identity and the 13-byte event sidecar's original deadline.
  Default hosts retain their nine-byte sidecar and existing context presentation.
- Firmware-only native workout state and native cross-app sharing remain unsupported
  on the stock path. Never label fixtures as a live phone or physical-watch test.

## Verification and releases

Run meaningful portable JS/C tests, cross-language wire fixtures and release-helper
tests. Build the SDK package before packaging a release. Timer PBW builds and its
native layout checks belong to its own repository. Record hardware and real-phone
checks separately. Pin source versions/checksums in consumers and preserve published
bytes. Library and consuming-app versions advance independently.

This repository uses the accompanying PolyForm Noncommercial license and required
attribution. Preserve notices on copied or adapted code.
