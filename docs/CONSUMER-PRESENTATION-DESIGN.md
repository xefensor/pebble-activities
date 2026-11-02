# Activity presentation across apps

**Status: browser design exploration, 2 November 2026; superseded as an
implementation plan.** The [use-case review](USE-CASE-REVIEW.md) records the
current architecture recommendation. The [native technical design](NATIVE-ACTIVITY-DESIGN.md)
documents version 1 compatibility, watch constraints and correctness work.
Neither adopts the general fact collection below as the native protocol.

The remaining sections preserve the earlier exploration and its
[interactive composition study](presentation-study/index.html). Browser results
do not establish native feasibility. These fields and budgets are experimental;
[specification version 1](SPECIFICATION.md) remains the implemented contract.

An activity is a reusable live summary. Providers own facts, identity and
authoritative state. Activities supplies the common contract and helpers.
Watchfaces and watchapps own rendering, selection and navigation. Any compatible
activity can occupy either Dynamic position. Authoritative sources retain
ownership of their operations, including alarms owned by a native timer app.

## Developer choices

The developer chooses **which information the user should see first**, together
with its label and optional supporting facts. That main information is typed:

| Content type | Meaning | Examples |
| --- | --- | --- |
| Text | Readable content or status | Track title, Left in 200 m, Verifying |
| Value | A scalar or formatted expression, with its unit where applicable | 72%, 180 °C, 2–1, 138 / 190 |
| Clock | Structured countdown or elapsed time, calculated locally | Departure countdown, elapsed run, a player's remaining time |

These are content types. Each consumer chooses its layout from the selected
content and available space. There is no separate emphasis enum to conflict
with the data, and no required layout ID, coordinates or font selection.
Friendly SDK helpers can construct a simple record without exposing all the
references needed by a richer activity. Their API remains to be specified.

Explicit selection answers questions that a general Clock or Value preference
cannot: which of two clocks, or which of several measurements? A workout can
select elapsed time while retaining interval countdown and pace as supporting
facts. An oven can select current temperature while also reporting its target
and cooking timer. A chess game can supply independently running and paused
clocks, each labelled with its player.

The source can change the selected main fact with a new revision as a session
progresses, preserving the run identity. A consumer normally preserves that
choice. An explicit user preference may select another available fact without
changing the source record. Automatic fitting must not silently replace a
percentage with a temperature or choose a different clock.

## A small record with labelled facts

Retain the existing identity, lifecycle, observation, validity, privacy and
unconfirmed semantics. Add a small, flat collection of labelled facts and an
explicit reference to the main fact. The study allows six facts to exercise
mixed-content cases; this is an experimental budget, not a future wire limit.

For example, the presentation portion of a printer record could look like this:

```js
{
  title: 'Boat print',
  headline: 'completion',
  facts: [
    { id: 'completion', label: 'Complete', type: 'value', value: 72, unit: '%' },
    { id: 'remaining', label: 'Estimated remaining', type: 'clock',
      mode: 'deadline', state: 'active', deadline: finishEpochSeconds },
    { id: 'layer', label: 'Layer', type: 'value', display: '138 / 190' }
  ],
  progress: { fact: 'completion', min: 0, max: 100 }
}
```

This is an illustrative shape, not a callable library API or plugin payload.
Fact IDs let main selection and progress refer to the same observation rather
than duplicate it. Other facts remain in source order. The collection is flat;
it supplies no widget tree, expressions or provider drawing code.

A formatted value may contain a score or current/target expression. A scalar
numeric value retains its numeric meaning. The study accepts either a scalar or
a display expression in a fact, preventing contradictory copies of one value.
The display expression excludes a separately supplied unit, which the renderer
appends in every size.
For example, formatted pace `5:12` with unit `/km` remains `5:12 /km`.

Progress requires an explicit source fact and valid numeric range. A percentage
and its progress bar derive from that one measurement. A gauge, elapsed time or
full battery does not imply completion of a process. Unknown progress and finish
times remain absent. Paused individual clocks retain fixed durations; a paused
activity cannot contain clocks that continue running.

An optional phase such as Rest or Boarding is separate from lifecycle state.
Optional artwork can support the summary. The current version 1 artwork limit
remains 40 by 40 pixels. Larger visual capabilities need a separate design.

## Presentations owned by each app

Compact, card and detail are useful descriptions of host presentations. Each
consumer can choose different sizes or implement only the presentations it needs.
Developers maintain one activity model, rather than separate payloads for every
screen or app.

| Consumer presentation | Same printer record |
| --- | --- |
| Dynamic primary | Prominent 72%, Boat print caption and supporting information that fits |
| Dynamic secondary | Boat print, Complete, 72% in a compact composition |
| Dashboard row | Activity label and selected percentage |
| Dashboard detail | Percentage, progress bar, remaining estimate and layer |

Primary and secondary remain placements owned by Dynamic and its user-facing
configuration. Neither position belongs permanently to music, timers or any
other domain. Selection and ordering remain consumer policies; this design
does not change Dynamic's current ordering rules.

Every presentation preserves the selected fact's meaning. Labels distinguish
Rest from Elapsed and White from Black. Units remain with measurements. Short
titles and labels may be supplied, while clocks continue to derive from time
anchors. A hard-coded compact string saying 6 min would become obsolete.

Consumers can omit optional facts and decorative artwork before reducing main
content readability. An essential visual needs a semantic fallback: a navigation
arrow can become Left in 200 m. A consumer must not discard the arrow and leave
only an unexplained distance. If required meaning or trust indications cannot
fit, omit the activity rather than invent a different main fact.

## Freshness and visibility

A locally changing clock does not refresh the source observation. A printer
countdown can be calculated while its last temperature or progress is obsolete.
The initial extension should keep coherent snapshots and conservative retention
rules, rather than introduce independent freshness for every field immediately.

The study applies these rules before rendering at any size:

- Denial, withdrawal, expiry and terminal states clear the activity.
- Private content clears when its source is unavailable or marks the snapshot as
  last reported. A connected phone alone does not confirm provider availability.
  Music and notification content remains private regardless of a provider's
  requested setting.
- An explicitly selected public clock can remain as Last reported until its
  original validity limit. Supporting measurements, phase text and progress are
  omitted. A value headline does not automatically switch to a supporting clock.
- Countdown zero is Due and unconfirmed, never proof of native completion or an
  alarm firing. Rendering leaves source identity, revision and state unchanged.
  This local uncertainty about completion does not itself make a live private
  source unavailable.
- Required labels, units and uncertainty indications apply in compact views too.

This deliberately narrows retained mixed content for the proposed extension.
It does not change version 1's published behavior. Returning plugin availability
does not confirm an old native snapshot. Private content remains excluded from
persistent caches and logs. Existing notification baseline and preview policies
continue to apply.

## Dashboard scope and controls

Dashboard can compose ongoing activities, readings and events while reusing
their display primitives. They retain their own lifecycle rules: a sensor reading
ages, a notification arrives, and an ongoing session can pause or end. Existing
compatible reading providers can still publish activity summaries; Dashboard
need not force all its future content through a session lifecycle.

The current activity feed retracts completed and cancelled records. A completed
build card, acknowledgement flow or history page requires an explicit result
retention design. A detail layout alone does not provide those behaviors.

Local hiding and placement belong to the consumer. Cancelling a timer or
acknowledging a source alert changes authoritative state and needs a real command
route with exact targeting, permissions and confirmation. The current reference
provider is read-only. Source actions require a separate working capability;
phone-storage writes cannot serve as native commands.

Maps, charts, ticket codes and more prominent graphics are possible later visual
capabilities, with meaningful fallbacks. Arbitrary provider-drawn UI, history
graphs and firmware work remain outside this direction. Dashboard navigation,
controls and its final visual design remain to be designed.

## Delivery and compatibility

One model means consistent identity and meaning across consumers. It need not
mean sending every detail to a watchface. A summary projection can remain small;
a future consumer can request bounded additional facts when it needs them.

The full phone catalogue, two-record ACT1 projection and reference publisher's
maximum eight slots serve different purposes. They do not establish a universal
limit for every future UI. Larger catalogue delivery needs an explicit protocol
that distinguishes partial pages from complete snapshots, so a missing record
on one page is not mistaken for a retraction. Design that protocol around an
actual Dashboard view and memory budget.

The fact collection and explicit main reference are absent from version 1.
Unknown schema versions currently fail closed. Final property names, bounds,
version negotiation and legacy projections must be specified before integration.
Keep ACT1 and its reserved fields unchanged until a versioned change is defined.
Library and consumer versions advance independently; published bytes stay fixed.

## Evidence and next implementation steps

The [composition study](presentation-study/README.md) contains 11 synthetic cases:
timer, private music, workout, printer, train, chess, unknown-progress job, oven,
score, navigation and long multibyte labels with a 24-hour countdown. Each uses
the same model in both Dynamic positions and Dashboard row/detail compositions.
Controls exercise an explicit main-fact override, time, connection, uncertainty,
permission, withdrawal and terminal state.

The study checks semantic projection and browser fitting. It does not establish
native Pebble rendering, transport compatibility, authoritative control delivery
or real provider integration. Its exact results are recorded alongside the study.

Before a production implementation, specify the bounded source and transport
extension and its version 1 projection, then add shared helpers. Integrate Dynamic
with native layout captures while retaining its established appearance and
notification/privacy behavior. Build Dashboard's transport and navigation around
its own requirements. Add commands or visual capabilities only when their
separate contracts and delivery paths are demonstrated.
