# Native activity technical design

**Status: version 1 compatibility and hardening design, 2 November 2026.** This
design targets stock PebbleOS on Emery, 200 by 228 pixels. The subsequent
[use-case and architecture review](USE-CASE-REVIEW.md) recommends a bounded
two-item next-generation view, with separate source/view revision semantics.
The existing bounds, native audit and correctness work below remain relevant to
the supported ACT1 path. No production implementation or native validation of
these changes is claimed. [Specification version 1](SPECIFICATION.md) remains
the published contract.

Version 1 maintenance retains source schema 1, ACT1 and the current bounded
activity record. It improves correctness and presentation inside those limits.
Dashboard can consume the same record with its own bounded window of activities.
Additional facts, arbitrary metric selection, progress protocols and source
commands require separate designs justified by native requirements.

## 1. Ownership and data flow

```text
Authoritative source
  -> provider plugin on the phone
  -> consumer discovery, validation and catalogue on the phone
  -> host selection of at most two canonical records
  -> one serialized AppMessage queue
  -> validated ACT1 state on the watch
  -> host layout, drawing and local clock calculation
```

For Timer, the authoritative source is the native watchapp. Its PKJS bridge
stores non-private snapshots in its own UUID namespace, and its plugin reads
them later. Timer continues to own persistence and Wakeup alarms. The reference
plugin reports those saved snapshots as unconfirmed; a successful plugin read
does not establish the current state of a closed native app.

Activities is a library bundled into providers and consumers. Each app owns
its SDK lifecycle, services, event handlers and message queue. There is no shared
native service or direct shared storage between watchapps. Music and notification
content remains transient and excluded from persistent caches and logs.

## 2. The plugin developer contract

Developers choose one useful summary for a run. Four authoring forms map to
existing fields; they do not introduce four screen layouts:

| Authoring form | Canonical source content | Native presentation |
| --- | --- | --- |
| Text | `clock: none`, `main`, `footer` | Existing body text composition |
| Value | `clock: none`, formatted `main`, optional scalar `value` and unit, `footer` | Existing body text composition |
| Countdown | `clock: deadline`, deadline or paused duration, `footer` | Existing locally calculated clock composition |
| Elapsed | `clock: elapsed`, duration and active anchor or paused duration, `footer` | Existing locally calculated clock composition |

Pure JavaScript authoring helpers can construct these combinations and return
normal schema 1 properties. Helper names and exports are to be specified during
implementation; they register no SDK handlers. Native publishers keep their
existing dictionary and receipt API. Neither API requires a layout ID or drawing
instructions. Use the existing phone package's JavaScript compatibility and
bundling conventions, with no browser DOM or browser-module dependency.

Presentation precedence is explicit: a structured clock supplies the main
display; otherwise supplied `main` text wins; a numeric-only record needs a
deterministic formatted main value. New authoring helpers should always generate
that value text so consumers receive a useful summary without domain-specific
formatters. Preserve supplied formatted expressions and units.

The developer chooses which metric to publish as the summary. A workout can
publish elapsed time or pace. Changing that choice is a source update with a new
revision. The first native API has no user-selected metric array. Independent
timer runs remain separate activities; additional metrics within one workout do
not become artificial extra runs merely to fill both positions.

`footer` is the concise caption; `name` remains its existing fallback. Both main
and caption should be meaningful to someone who has not opened the originating
app. Storage byte limits are not a guarantee that all the text fits on screen.

## 3. Fixed bounds and artwork

Keep the current wire and storage limits:

| Item | Bound |
| --- | --- |
| Native records in one ACT1 snapshot | 2 |
| Provider UUID / run ID / semantic kind | 36 / 64 / 24 UTF-8 bytes |
| Main / caption / unit | 192 / 128 / 16 UTF-8 bytes |
| Structured clocks per record | 1 |
| Artwork | One image or icon, at most 40 by 40 pixels |
| Pixel format | Packed 4bpp, at most 800 pixel bytes and a 16-byte palette |
| Complete ACT1 frame | At most 2,672 bytes, before AppMessage dictionary overhead |

An album cover, provider icon or team logo uses the same optional artwork slot.
The first contract does not carry both a separate source icon and a separate
cover image. Image/icon variants resolve to one canonical bitmap. Essential
visual meaning must also appear in the readable summary, such as Left in 200 m.

Request artwork with a fixed 40-pixel bound. Keep dimensions, palette and pixels
deterministic for a given source revision. The native renderer may omit the
image for a smaller presentation. It must not require the phone to remove and
restore image data when a record changes position.

## 4. Canonical records and revisions

Provider UUID and run ID identify a run. Source revisions are immutable and
monotonic under the existing rules. Observation and validity remain source times;
phone polling does not renew them. The source owns terminal transitions and a
restart uses a new run ID.

An ACT1 packet has an independent native session and snapshot sequence. The
sequence orders packets; it does not authorize changing a source record at the
same source revision. Current native validation compares text, clock fields,
numeric data and image bytes for repeated provider/run/revision identities.

Therefore the canonical record must be identical across primary, secondary,
list and selected-card presentations:

- Do not shorten source text on the phone according to the selected position.
- Do not strip secondary artwork and add it back upon promotion.
- Do not rewrite the clock or main metric as a host preference.
- Derive typography, truncation and local clock text inside the renderer.
- Keep the existing unconfirmed provenance annotation exception, without
  treating provider availability as authoritative native confirmation.

Normalization must also be deterministic. There is a current edge requiring a
regression test: the phone consumer caps music validity using receipt time,
which can change native bytes for an otherwise identical source revision. A
source-derived cap should use the authoritative observation time, bounded by
the original validity, or remain separate local policy metadata. It must not
silently extend validity on reread.

## 5. Phone consumer and transport

Retain compatible-provider discovery, allowlists, actual returned UUID checks,
complete source lists, revision/tombstone checks and bounded retry behavior.
The full validated catalogue stays on the phone. Hosts select at most two
unchanged records from it. Dynamic keeps its existing selection and ordering
policy; this design adds no global plugin priority flag.

Serialize sends through the host's existing queue. An ACT1 update replaces a
complete selected window atomically; partially received records never draw.
Do not combine the maximum Core context frame and a maximum ACT1 frame into a
dictionary larger than the configured inbox. Queue them as separate messages.
Unchanged source payloads need no phone transmission for every clock second.

Keep the session bootstrap and rotation on native launch, reconnect and new
phone runtime. Reject old sessions and packet sequences. Reprojection within a
session advances the packet sequence while preserving each source revision.

On the watch, the SDK owns the receive dictionary and byte pointer. Validate
and decode during the callback. Do not retain an iterator or a pointer into its
buffer. Preserve the current two-pass decoder and direct wire comparisons;
avoid a second image-sized temporary snapshot on the stack.

## 6. Native memory and size budget

The current Dynamic build and ARM type audit provide this baseline:

| Measurement | Bytes | Meaning |
| --- | --- | --- |
| Loaded image | 62,420 | 3,115 below the SDK's 65,535 load-size limit |
| Text, data and BSS total | 62,834 | 2,701 below the separate 65,535 virtual-size limit |
| Complete native binary | 65,212 | Includes relocation data; do not use this to calculate either margin above |
| SDK reported heap before startup allocations | 68,238 | Not measured free heap while the app is running |
| `PaActivity` / `PaSnapshot` / `PaState` | 1,328 / 2,672 / 2,688 | Existing bounded ARM structures |
| Dynamic `NativeState` allocation | 22,376 | Includes `PaState`; do not count the latter twice |
| Dynamic inbox / outbox requests | 6,144 / 64 | SDK buffer requests, separate from application state |

Keep `PaActivity`, `PaSnapshot`, `PaState`, payload bounds and Dynamic's message
buffer requests unchanged in the first implementation. Continue allocating
Dynamic's bounded `NativeState` once at startup. Both records already reserve
artwork storage; do not add image caches, per-frame bitmaps or persistent layout
copies. Reuse current font resources and drawing primitives.

Check `app_message_open` success. A failed transport initialization must not
start a loop claiming requests or synchronization succeeded. Dynamic's basic
clock and direct watch services should remain usable where initialization permits.

Compile after each native change, recording loaded and virtual sizes. Measure
runtime heap after fonts, buffers and layers are initialized and during worst
combinations of artwork, notifications and transitions. Acceptance requires no
allocation failures or unbudgeted heap regression against the measured baseline,
and no allocation growth during repeated steady-state redraws. If code does not
fit, reduce or refactor it before adding features.

Review compiler stack-usage output and worst-case callback call chains as well.
Text buffers and `MusicLayout` are substantial even without heap allocation.
Shared preparation must reuse the caller's plan storage instead of leaving a
second full local plan live beneath it on the stack.

## 7. Dynamic layout and compact summaries

Retain the current native geometry and measured font paths:

- Text/value main content uses 24px body text, with a 20px caption.
- Clocks use existing rounded numerals at 58, 48, 38, 32 or 26px as measured
  within 180px. The main baseline is 160; the imageless caption is grouped below.
- Primary artwork occupies the existing 40px home.
- Secondary content is an optional 14px summary within 180px.
- A heading banner suppresses the secondary. The existing clock-plus-artwork
  composition also omits it. Full notifications and Peek retain host priority.
- Text continuation keeps the current one-time behavior; there is no generic
  browser-style shrinking or looping title animation.

Any compatible activity may occupy either position. This means domain-independent
eligibility, not that both positions expose identical detail or always fit.
Only the primary draws artwork in this first Dynamic implementation.

The compact formatter uses the same main content or locally calculated clock.
It should include a concise caption when needed to identify a measurement, as
well as the existing clock-plus-caption summary. Reserve space for pause and
last-reported marks before measuring and ellipsizing text. Reuse existing mark
drawing primitives. If required state or a meaningful clock/value cannot fit,
omit the optional summary instead of showing misleading content.

The rounded font contains only `0123456789:.-+,/%°CF`. Arbitrary expressions
such as 6.2 mmol/L stay on the body font path. A distinct large-value composition
is a separate host improvement requiring glyph coverage, layout captures and
size checks; it needs no new source property merely to choose a font.

Reset one-time continuation when the selected provider/run changes, even if
another source happens to supply the same main text. Borrowed record pointers
are valid only within the current callback; incoming packets can replace a slot.

## 8. One clock scheduler for the visible content

Drawing and scheduling should share one bounded preparation operation. It uses
one `now`, resolves the two accepted records, formats existing text buffers and
measures the actual layout. Its result includes whether the secondary is drawn
and which visible clocks change. Do not persist another snapshot or full layout.

The existing scheduler checks only the primary. Replace that rule with:

```text
needs_second_tick =
  focused AND activity_area_visible AND (
    primary_clock_changes OR
    (secondary_is_drawn AND secondary_clock_changes)
  )

clock_changes = active elapsed clock OR active countdown above zero
```

Use one app timer for both records. Align a newly scheduled timer to the next
wall-clock second with the SDK millisecond clock. Keep an already pending timer
when it remains useful; cancelling and restarting it after every source packet
can postpone the visible tick. At callback, clear the handle, read accepted state,
prune expiry, prepare and redraw, then schedule again if needed.

Stop second ticks for paused clocks, hidden content, focus loss and countdowns
already drawn at zero. Resume from time anchors on visibility or focus return;
do not replay missed seconds. Keep the minute subscription for the watch clock
and the independent validity/expiry timer. Countdown zero remains due/unconfirmed;
it does not change the source state or trigger a remote alarm.

Use the existing uncertainty mark when `clock.estimated || clock.due`, in either
presentation. The current renderer checks only `estimated`. This derived visual
mark must not rewrite the source's private/unconfirmed flags or lifecycle state.

## 9. Availability and privacy corrections

Retain only public last-reported clocks when source availability is lost, up to
their original validity. Private and non-clock content clears. Denial, withdrawal,
provider removal and expiry override retention. Reconnect alone does not confirm
the reference Timer's cached native snapshot.

The native `clear_private` implementation currently retains public non-clock
records too, unlike the specification's unavailable-reading rule. Correct this
within ACT1 and add a native C regression case before extending the presentation.
The name of the helper may change to reflect its actual availability role.

Compact pause and uncertainty marks are also required native correctness work:
today's secondary text omits those marks. Applying the same provenance rules in
both positions is part of the first implementation, not an optional rich feature.

## 10. Dashboard with a bounded viewport

Dashboard is a separate future native app with its own UUID, lifecycle and UI.
Its first view can hold two rows and open a selected record's card using Up,
Down, Select and Back. Row/card switching reuses the same two stored records;
the selected card initially contains the same summary, caption and artwork.
It does not request additional facts or change the source representation.

Keep one `PaState` on the watch and the catalogue on the phone. For navigation,
add a small JavaScript-only `reproject()` operation that republishes the selected
window without rediscovering or rebinding providers. Current `refresh()` and
`configure()` rebind sources, so do not call them on every button press.

Paging can remain Dashboard-specific AppMessage keys outside ACT1:

| Direction | Fields |
| --- | --- |
| Request | Native session, request ID, known catalogue generation, requested offset |
| Reply beside `ACTIVITY_DATA` | Reply request ID, catalogue generation, actual offset, total count, viewport status |

All fields are bounded unsigned integers. Use two-record windows with an offset
clamped to the current catalogue. Catalogue generation changes when eligible
identities or their order change. An old offset is a position, not an identity;
return the actual offset and new generation when the list changed. Compare
provider/run identity before preserving a selected card after an update. If it
disappears, return to the list rather than display another run under its selection.

Compute the window and reply metadata from the same catalogue snapshot. The
existing host send wrapper can attach the metadata synchronously after selection.
Send metadata and ACT1 in the same queued dictionary. Empty-clear paths must
generate fresh zero-count metadata rather than reuse a previous page description.
Any queue that coalesces snapshots must register all reply fields as sidecars of
`ACTIVITY_DATA`, so replacement cannot pair one frame with another window's
metadata.

Viewport status distinguishes Loading, Ready, Partial and Unavailable. Only
Ready with zero records establishes an empty allowed catalogue. Explicitly track
initial discovery completion; current `status().ready` alone can be true before
enumeration finishes. Provider failures must not make a partial list look complete.

Keep one navigation request outstanding. While waiting, hide the previous page
and show Loading without fabricating source retractions. Back stays usable.
Native Dashboard checks the reply request ID, then ACT1 session and sequence,
and commits page metadata only when the frame is accepted. Discard old-page
replies; never rotate the native session merely to turn a page.
Before passing a frame to `pa_state_receive`, validate the reply fields together:
the status enum, bounded total and offset, expected request ID, and consistency
between the selected-window bounds and the frame's record count. Invalid metadata
must not replace activity state while leaving the old page description attached.

With current dictionary tuple sizes, four uint32 request fields occupy 45 bytes.
A maximum reply is 2,672 + 7 + 1 + 5 × 11 = 2,735 bytes. A proposed activity-only
Dashboard inbox of 3,072 bytes and outbox of 64 therefore has room for this format;
verify these calculations with SDK dictionary sizing and native allocation checks.
Dynamic retains 6,144 bytes because it also hosts Core traffic.

Each ACT1 frame is a complete selected window. An omitted record is no longer
visible in that window; its omission does not cancel it in the phone catalogue.
Keep phone revision/tombstone checks across windows. Offline browsing is limited
to the current retained window; uncached pages require the phone. No persistent
native catalogue or history is added.

## 11. Commands and deferred extensions

Hiding a card is a consumer preference. Pausing, cancelling or acknowledging an
authoritative activity requires a real source command route and confirmation.
The reference provider currently has none. Treat app launching and plugin action
capabilities separately from implementing a native Timer command path; this
design does not declare them platform-impossible or provide them by storage writes.

The first implementation adds no structured progress, field array, multiple
clocks in one record, separate compact payload, larger artwork or arbitrary
metric picker. Source and native protocol versions remain independent. A later
extension must specify compatibility, bounded bytes and revision semantics before
using new fields or ACT1 reserved bytes.

## 12. Implementation order and native acceptance

1. Add focused regressions for deterministic same-revision serialization,
   disconnect clearing of public non-clock records and source/packet ordering.
   Fix those correctness issues inside the existing contract.
2. Add pure authoring helpers for the four content forms, preserving native
   publisher APIs and all current bounds. Verify canonical field and clock
   combinations with the existing JS/C cross-language fixtures.
3. Add compact state marks and shared view preparation in Dynamic. Correct the
   visible-clock scheduler. Check native size after each change.
4. Capture the exact resulting native renderer and measure runtime allocation
   behavior before adding another presentation feature.
5. Implement Dashboard's bounded viewport only when its native app work begins.
   Test app-specific page correlation and discovery completeness before controls
   or richer content.

Native acceptance must cover text primary plus ticking secondary, two visible
clocks, paused and due transitions, last-reported secondary marks, two maximum
images, long captions and 24-hour clocks. Also cover banners, full notifications,
Peek, focus changes, denial, expiry, reconnect, unchanged revisions, slot reuse
and malformed packets. Exercise two full images during repeated redraws and
receive bursts, recording code sizes, heap minima and steady-state allocations.

Use existing native C/layout tests and final-PBW emulator captures. Browser checks
remain conceptual evidence. Physical-watch checks are required for responsiveness
and power conclusions; the user's successful test of the current releases does
not validate these new combinations. Changed implementation bytes require new
library/app versions and normal pinned dependency, build and release validation.

## Source anchors

- [Current source and wire specification](SPECIFICATION.md)
- [Native bounds and structures](../include/pebble-activities.h)
- [Phone consumer and projection](../src/js/consumer.js)
- [Canonical normalization and encoding](../src/js/wire.js)
- [Native decoding, revisions and retention](../src/c/pebble-activities.c)
- Dynamic: `src/c/dynamic.c`, `src/c/activity_presentation.h`,
  `src/c/music_layout.h` and `resources/fonts/font-provenance.json` in the
  separately versioned `dynamic-watchface` repository.
- Size limits were checked in the local SDK used by the recovery build:
  `common/tools/inject_metadata.py`, load and virtual-size validation.
