# Activity Timer reference watchapp

A small one-shot timer demonstrating stock PebbleOS activity sharing. The
watchapp owns its persisted timer and Wakeup alarm. Its PKJS saves a snapshot
in phone storage; a read-only plugin in the same PBW exposes that snapshot as
`activity/session` v1 to Dynamic and other consumers.

The timer is an example, not a replacement for Pebble's built-in Workout or an
automatic adapter for other timer apps. It uses only built-in fonts and targets
the Time 2 (`emery`, 200 × 228).

## Controls

- Select starts the chosen duration, pauses it, or resumes it.
- Up adds one minute before or during a timer.
- Down reduces the chosen duration before starting (minimum five seconds), or
  cancels an active/paused timer.
- Back always exits. A successfully scheduled native Wakeup remains active.

The watch displays whether its current revision was accepted into phone-side
shared state. "Shared with phone" does not mean Dynamic has received it. A native
outbox ACK is deliberately insufficient; PKJS must save and read back the snapshot
and return the accepted run, revision and handoff session. The revision floor on
the PKJS ready request also permits resynchronization after native app data resets
without allowing a queued older run to overwrite newer phone state.

The plugin explicitly marks its record as last-reported/unconfirmed. A successful
phone receipt proves the handoff, but later plugin polls cannot prove that the
native timer has not changed while the phone was unreachable. Reconnection alone
does not upgrade this cached report to live native confirmation.

Every state change is persisted before publishing. A native owner observation
is refreshed when the timer app is reopened, never when the plugin merely polls
the saved record. The provider keeps the original deadline and validity: running
timers do not vanish after a short music-style lease. Cancelled/completed records
are terminal tombstones, not fresh events to alert from the consumer.

## Build

Build the library first, because the example consumes its SDK package:

```sh
cd ../..
pebble build
cd examples/timer
npm install --ignore-scripts
python3 scripts/test.py
python3 scripts/build.py
```

`scripts/build.py` bundles the provider's shared JavaScript helpers, builds the
native watchapp, and writes `dist/Activity-Timer-0.1.0.pbw`. Its appinfo has
`manifestVersion: 2`, and `plugin.js` is explicitly included alongside PKJS and
the watch binary. A plain `pebble build` produces a development PBW without that
extra provider bundle. The packaged PBW carries the root license, third-party
notices and Apache 2.0 license for the SDK's injected PKJS support code.

## Verify the actual stock-phone handoff

1. Enable the plugin/permission preview in the stock Pebble phone app. Install
   the packaged timer PBW and the compatible Dynamic PBW on the same Time 2.
2. Open Activity Timer, choose a duration, and press Select. Wait for "Shared
   with phone", then press Back to return to Dynamic. The activity should appear
   with the same deadline and a locally advancing countdown.
3. Reopen the timer and pause it. After sharing and returning, Dynamic should
   retain a fixed remaining duration. Resume, extend and cancel in turn. Each
   operation must update or remove the same run without replaying a completion.
4. Start another run and immediately press Back before the application receipt.
   The timer must still work. An old receipt must not acknowledge the new run;
   sharing must remain pending/unconfirmed until a matching receipt arrives.
5. Disconnect Bluetooth while starting or changing a timer. Back must remain
   usable. The local alarm should still alert if the watch accepted its Wakeup;
   Dynamic must not invent an unsent new state or infer that the alarm rang.
6. Reconnect and reopen the timer. Verify the current native state replaces the
   phone snapshot, including after restarting the phone app or reinstalling the
   native app. Test competing Wakeups and the five-second minimum on the actual
   firmware; scheduling failures must display "Alarm not set" rather than claim
   a background alarm was secured.

The timer respects Quiet Time for its vibration. The watch's missed-Wakeup
notification policy remains native PebbleOS behaviour. The worker API is not
used, and no permanent background phone process or per-second messages are
needed.

Portable model/bridge tests and emulator renders are separate from these live
phone and physical-watch checks. Do not describe unperformed steps as verified.

For local Wakeup diagnosis, run `ACTIVITY_TIMER_DIAGNOSTICS=1 pebble build`.
The opt-in native logs report the requested and queried alarm time, Wakeup ID,
launch reason, launch event, foreground callback and exit state. They contain
only the example's public timer state. Normal builds omit these logs; rebuild
without the environment variable before packaging a release. A stored Wakeup
and a completed timer shown on manual reopening do not prove automatic launch.
