# Activity use cases and architecture review

**Status: recommended next-generation direction, 2 November 2026.** Xef
authorized reconsidering the architecture from the ground up. This review
compares the current native summary with broader activity requirements. It
recommends a bounded main-plus-supporting-item view and separate source/view
revision semantics. This is not an implemented source or wire specification.
[Specification version 1](SPECIFICATION.md) remains published behavior; the
[native design](NATIVE-ACTIVITY-DESIGN.md) remains the compatibility and
correctness-hardening plan for that path.

## What the comparison establishes

The current contract can provide a useful summary for many domains. That does
not establish that it preserves every important relationship or supplies an
entire Dashboard view. The comparison below separates those promises.

Use cases are grouped by information shape, time behavior, lifecycle and required
interaction. Combinations matter more than domain names: a train and a cooking
timer can both need a countdown, while one workout can need two different clocks.
These are design cases, not claims of shipped integrations or acquired data.

## Comparison across activity families

| Family and examples | Current one-item summary | Main plus supporting item | Remaining requirement |
| --- | --- | --- | --- |
| Cooking, focus, parking, sleep and simple timers | A labelled countdown fits directly | Same useful default; support can show a phase or context | Native owner still schedules alarms |
| Stopwatch, meeting, call and presentation duration | One elapsed clock fits | Duration plus subject, slide or other context | Source must actually report start, pause and end |
| Intervals, breathing, recipes, brewing and study stages | Current phase countdown works; total elapsed cannot also tick locally | Phase remaining plus session elapsed | Source owns phase changes; zero does not advance a state machine |
| Paused workout with wall time | One global clock state cannot represent both meanings | Active-duration clock can pause while wall-time clock continues | Each clock owns its running state independently |
| Travel departure and arrival | One chosen countdown works | Destination/status or departure time alongside countdown | Source owns delays, platform changes and journey phase |
| Transit connection or itinerary | One next step can be summarized | Next departure plus connection margin or destination | Full itinerary is a richer application view |
| Navigation on foot, bicycle or route | Left in 200 m can be meaningful text | Instruction plus distance or ETA | Reliable position updates and full map display are separate |
| Exercise pace, distance, heart rate and elapsed time | One metric, or a flattened expression | Two chosen measurements or a measurement plus clock | Four simultaneous metrics need another bounded view or the source app |
| Repetitions, sets, rounds and targets | 3 / 8 or 12 reps fits as text | Repetitions plus rest countdown | Source owns detecting a repetition or changing a set |
| Music, podcast, audiobook and livestream | Title, caption and 40px art already fit the model | Title plus artist, chapter or position, with art | Playback controls and source availability are separate |
| Calls, conferencing and mute status | A useful status or duration fits | Duration plus caller/topic/status | Answer, mute and end need an actual command route |
| Match score, game period and match clock | Score can be text; adding a structured clock makes that clock main | Score stays main with live match time supporting it | Detailed statistics and game interaction stay outside the summary |
| Normal chess and turn games | Active clock can be main; paused opponent time can be caption text updated on a turn | Explicit player clocks and labels are clearer | User moves and clock authority remain with the game |
| Downloads, backups, builds, rendering and printing | Percentage or stage text works | Percentage plus ETA; optional meter from that measurement | Unknown work stays unknown; elapsed time is not completed work |
| AI jobs, automation and approvals | Task/stage text is useful | Current stage plus known count, elapsed time or waiting status | Approval is an authenticated source operation |
| Oven, fermentation, brewing and making | Current/target expression works; live cooking time competes for main position | Current/target main plus remaining time | Temperature observations must retain their real sample age |
| Washer, dishwasher, vacuum and other appliances | Cycle/stage or countdown works | Stage/amount plus ETA | Device integration and offline native changes are not supplied by layout |
| Charging, battery, UPS and energy transfer | Charge or remaining time works, with a choice of which dominates | Charge/target plus remaining time or power | Energy level and process completion have different meanings |
| Solar, heating and environmental measurements | One scalar or formatted pair works | Two labelled values or a value plus target | More sensors need an explicitly richer view, with their own ages |
| Delivery, takeaway, taxi and appointment queues | Status or position works | Position/stage plus ETA | Source still owns arrival, delivery and service completion |
| Prices, exchange rates and market observations | Formatted value/change works | Value plus change or observation context | No invented refresh or freshness while disconnected |
| Glucose, hydration, habits and personal observations | Value/target can be shown; availability rules matter | Value plus trend/status/target where genuinely supplied | Data access, trustworthy timestamps and alert guarantees are separate |
| Pets, plants, watering, feeding and maintenance | Last or next action can be summarized | Last-reported observation plus next deadline | An old reading can be useful only when age and permission are explicit |
| Home, connection, lock and device states | State text works | State plus device/context/last observation | Unlock, switch and acknowledge are distinct source commands |
| Events, calendar and notifications | A bounded summary is possible | Subject plus time/context | Preview permission, baselines, event lifecycle and acknowledgement remain source-specific |
| Completed job, delivered parcel or final result | Terminal records currently disappear immediately | A bounded result card can remain with explicit permission | Visibility must be separate from lifecycle; history remains separate |
| Multiple timers, jobs, devices or sessions | Separate identities and phone selection already work | Same model; two items belong to each activity | Catalogue paging and selection remain host-owned |
| Disconnected sensor, printer or charger | Public non-clock content currently clears | Optional last-reported value with original age and expiry | Retention must be explicit; public does not mean retain indefinitely |
| Album art, contact, team, device or provider icon | One 40px bitmap is supported | Same artwork slot | The host may omit it when space is needed for meaning |
| Small rendered trend or schematic | A provider could supply a thumbnail | Same limited supporting bitmap | A thumbnail is not a general history/plot API |
| Full map, radar, chart, ticket or QR code | Text can describe availability but may not replace its function | No fundamental improvement from a second text/clock item | Needs a separately sized visual capability and real usability/scanning tests |
| Interactive game, editing, lists and multi-step workflow | Can report current state | Can report two important parts of current state | A summary contract does not provide the full interaction model |

## What should change

### One main item and one optional supporting item

Use the same small content vocabulary for both items: text, formatted value or
structured clock. Each has a meaningful label. Retain one caption/title and
one optional artwork slot. A value may carry an explicit range for a meter.

This directly represents common combinations without special music, workout,
oven or train layouts:

- Printer: percentage and estimated remaining time.
- Charging: charge and ETA or charging power.
- Workout: interval remaining and total elapsed or pace.
- Oven: current/target expression and cooking time.
- Match: score and match clock.
- Music: track and artist or position, with cover art.
- Unknown job: stage and task/context, without invented progress.

Keep related expressions such as 2–1 and 180 / 200 °C as one formatted value
where that preserves meaning. No generic nested field tree or universal six-fact
collection is needed to support these cases. A provider may own richer data and
export only the bounded view that a compatible consumer understands.

The supporting item is information **inside one activity**. It is different
from Dynamic's secondary activity, which is another independently identified
record. A compact consumer can show only the main item and caption. A larger
card can show both. Any compatible activity remains eligible for either Dynamic
position; identical detail at every size is not promised.

The two-card storage experiment is a reference profile, not a universal catalogue
limit. Each native host must declare a fixed record capacity and frame budget,
and its paired phone projector must respect both. A larger Dashboard can choose
its own measured capacity; the watch never accepts an unbounded list.

This is a bounded proposed native capability, not a required layout ID. Native
hosts own fonts, geometry and fitting. Unsupported characters use an appropriate body
font. Artwork, a meter, a supporting item and another activity's compact summary
compete for space; all must not be promised simultaneously before native layout
proof. Dynamic may expose a smaller profile than a future Dashboard.

### Separate source truth from a native view

The current ACT1 rule makes all main/footer/art bytes immutable for a source
revision. That blocks changing presentation or selecting a different available
datum without pretending the source changed.

Keep source revision strict on the phone: reject conflicting authoritative
snapshots, rollback and terminal resurrection before projection. Then produce a
bounded native view with its own ordering. A new native protocol can use the
existing session-scoped packet sequence as the view revision; it does not need
another per-record revision counter.

A newer view sequence may shorten labels, change a supported projection or omit
artwork while the source revision stays the same. Source identity, state,
observation, validity and privacy retain their authoritative meanings. The
native receiver checks source-owned metadata and lifecycle consistency, rather
than demanding identical presentation strings. A new view cannot revive a
terminal run or extend a source's original validity.

Native per-record checks cover resident cards. Catalogue-wide rollback checks
and terminal tombstones remain phone-owned across page windows. Session and
view sequence protect delivery ordering; they do not replace source validation.

This is a versioned redesign. It must not weaken ACT1's existing comparisons in
place or claim old receivers accept new meanings. Selecting another metric also
requires that the provider actually exposes it; a projection cannot manufacture
data missing from a source.

### Give each datum its own time and quality

A clock can keep changing while an accompanying observation is old. Each item
therefore needs its authoritative observation/anchor and validity, bounded by
the activity's overall validity. Polling and rendering never renew a sample.
If supporting information expires, omit it. If the selected main item cannot
be shown honestly, hide the card; do not silently promote another metric.

Clock running state belongs to each clock. A paused workout can freeze active
duration while wall time or an unrelated departure deadline continues. The host
must not infer that every clock stops from the activity's global pause state.
Providers define those relationships and labels. Source lifecycle still cannot
be inferred from either clock reaching zero.

An age such as Reported five minutes ago derives from the original timestamp.
Ended five minutes ago requires an actual end timestamp; observation time alone
does not establish it. A result's age never reactivates its run.

### Make retention explicit

Privacy, availability and retention are separate decisions. Private content
still clears on loss of availability. A public source may explicitly allow a
value or clock to remain last-reported until its original validity limit. The
consumer must show appropriate uncertainty and age, or omit it when that meaning
cannot fit. Default to clearing, not retaining every public observation.

This avoids treating a native countdown as inherently more current than a
temperature or charge observation. An unsent pause can make that countdown old
too. A last-reported value can still be useful when permission and age are clear.
Host policy may tighten retention, never loosen source privacy or extend expiry.
Permission to show last-reported data is not permission to add persistent caches
or history storage; those remain separately controlled.

### Separate completion from visibility

A completed build or delivered parcel may deserve a short result card. Preserve
the terminal state and tombstone, but allow an explicitly bounded visible result.
Default to immediate removal. Keep restart identity and no-resurrection rules.

This requires a new contract: current completed/cancelled records retract and
must not be kept visible by pretending they are active with the caption Done.
Result visibility is transient; it does not imply a persistent history service.

### Keep a meter tied to real data

An optional meter derives from a declared numeric measurement and valid range.
Its displayed value and normalized fill must have one source, with an explicit
meaning such as work progress or level. Full battery, target temperature or a
100% bar is not an authoritative completion event.

The phone can normalize the fraction for a small native field, leaving raw
numeric formatting and unit metadata on the phone. An unknown range produces no
meter. A clock alone must not invent a work-completion fraction. Continuously
derived clock meters would need their own explicit semantics and native proof.
The meter inherits its referenced item's validity, retention and uncertainty.
Hide it if that item expires or cannot be shown honestly; another ticking clock
does not keep an old meter current.

## Actual storage experiment

The [ARM storage probe](design-review/storage-probe.c) compares a concrete
candidate with the current header. It retains full provider/run IDs, source
revision and times, two typed items with individual timing metadata, caption
references, an optional normalized meter and the existing 816-byte artwork
storage. All rendered strings share one 320-byte pool, including terminators.

| ARM allocation | Current | Candidate |
| --- | ---: | ---: |
| One item descriptor | — | 28 bytes |
| Activity/card | 1,328 bytes | 1,324 bytes |
| Two-card snapshot | 2,672 bytes | 2,664 bytes |
| State wrapper | 2,688 bytes | 2,676 bytes |

These were measured with the recovery ARM compiler, not a desktop struct-size
estimate. [The saved result](design-review/storage-results.json) records the
compiler and measurements. Reproduce from the repository root with an ARM
toolchain on PATH:

```sh
arm-none-eabi-gcc -std=c99 -Wall -Wextra -Werror -mthumb -mcpu=cortex-m4 -Iinclude -c docs/design-review/storage-probe.c -o /tmp/pebble-storage-probe.o
arm-none-eabi-nm -S --radix=d /tmp/pebble-storage-probe.o
```

This is feasible by removing native copies of raw numeric doubles, separate
units and semantic kind strings that the renderer need not consume, and by
pooling text. Units remain in projected display text. Numeric meaning and
reserved music/notification privacy policies remain enforced by the phone's
validated source adapter. Native privacy/expiry checks still apply.

The text pool is a real constraint: labels, both items and caption share its
budget. It cannot hold every field at the old independent maximum simultaneously.
The projector needs bounded UTF-8 handling and native measured fitting. Scalar,
clock, unit and trust information must not disappear through arbitrary truncation.

The probe proves allocation size only. It is not a serialized wire format and
must not be transmitted by copying a C struct. Decoder, renderer, stack, wire
limits and update cost have not been established by it. Dynamic's current
2,701-byte virtual-image margin still constrains that app's integration. A new
Dashboard has its own code and heap budget; Activities should not permanently
inherit every restriction of Dynamic 0.8.

## Architecture and compatibility decision

Keep the shared source/consumer separation. Improve the boundary between source
and native view rather than rewrite Timer, Dynamic, Dashboard and all providers
into a single framework.

| Option | Decision |
| --- | --- |
| Freeze ACT1 as the universal model | Keep it as the supported compatibility profile; its common two-item gaps justify a next profile |
| Send a general field tree to the watch | Reject for the initial redesign; it makes native parsing, fitting and memory less predictable |
| Main plus one supporting typed item | Recommended bounded next-generation view |
| Separate source revision and view sequence | Required for deliberate projection changes |
| One universal app UI or installed service | Outside the architecture; consumers and authoritative apps keep their own runtimes |

Existing schema 1 providers, including Timer, can be adapted on the phone into
the new view. A legacy clock remains the main clock; do not guess that an unused
legacy text or numeric property is an independently labelled metric. A new
provider convention must explicitly expose any additional item. Use existing
platform property shapes, define its version independently of the native wire,
and provide an explicit legacy source where backward compatibility is needed.
Old consumers reject unknown schema versions and must remain supported as they are.

New consumers should initially compile one native decoder, with legacy source
adaptation on the phone. Supporting two native codecs is optional only if its
measured code budget allows it. Published PBWs, libraries and tags stay unchanged;
apps advance and repin dependencies independently.

The new compact profile can show one main item, caption and required trust marks.
The card profile can expose the main and support items. A future richer Dashboard
may request another bounded view if the provider exposes it; no universal six-fact
source array is required now. Dashboard's catalogue paging and view correlation
remain app-owned, with metadata and records committed atomically.

## Boundaries a redesigned packet cannot solve

- A provider must own or obtain its data. This adds no built-in Workout access
  and cannot reveal a native pause that never reached the phone.
- Source commands need permissions, exact targeting, operation identity and
  authoritative results. Local Hide, source Acknowledge and source Cancel retain
  different meanings. A button label is not a working command path.
- Reliable alarms and timely attention require an actual source/alarm path and
  user/host policy. Presentation does not establish those guarantees.
- Readings, events and ongoing sessions may share view primitives while their
  source adapters keep different lifecycle, baseline and acknowledgement rules.
- Maps, full charts, ticket codes and other functional graphics need separately
  budgeted native capabilities. Forty-pixel artwork can be useful but does not
  prove map usability or QR scannability.
- Full history, editing, live video, complicated games and multi-step interaction
  remain application capabilities. A live summary is still useful for them.

## Gates before implementation is frozen

1. Specify a new native view format, field bounds and source adapter contract.
   Keep source truth and presentation sequence separate, with explicit privacy,
   per-item validity, retention and terminal-result rules.
2. Build three decisive native cases: value plus supporting clock and artwork;
   interval countdown plus elapsed time; and the compact one-item fallback next
   to another activity. Preserve meaningful labels and state indications.
3. Measure loaded/virtual image size, stack call chains, runtime heap and repeated
   redraw behavior in the actual host. The struct-size result alone is insufficient.
4. Test source rollback, conflicting same-revision source snapshots, legitimate
   same-source-revision view changes, stale view sequences, partial expiry, private
   redaction and retained terminal results without resurrection.
5. Test source and clock pause independently, unavailable public values/clocks,
   unknown progress, result expiry and catalogue/page changes. Every activity
   must remain eligible for either host position within that position's profile.

The resulting promise is bounded: compatible sources can provide useful summaries
in any supported placement; the card profile supports two related pieces of
information. Full information and interaction require explicitly supported
capabilities. This is stronger than flattening every domain into arbitrary text,
without claiming that one card can replace every future application.
