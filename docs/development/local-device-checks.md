# Local pre-round device checks

VIDEO owns `apps/web/src/features/video/browser-device-checks.ts` and its
injected controller in `device-check-controller.ts`. ROOM owns the check UI
and CAP readiness commands. CAP owns current-version consent and start.

Construct `createBrowserDeviceChecks()` in a client, then call `check('camera')`
and `check('microphone')` from user gestures. The camera check observes a
rendered video frame; the microphone check observes RMS level of at least 0.01.
A bounded ten-second observation failure is unavailable, not passed silence.
A browser permission prompt can remain unanswered: its generation may be
superseded or disposed, and a late acquired stream is stopped without passing.
Audio analysis never connects to speakers, a recorder or a network transport.

- `readSnapshot()` returns a stable immutable snapshot until the next update.
- `subscribe(listener)` returns an unsubscribe function. The listener receives
  the snapshot and, for invalidation, the input, new generation and reason.
- `select(kind, deviceId)` invalidates only that input synchronously.
- `preview(kind)` returns its locally retained stream, or null.
- `dispose('departure' | 'round-transition')` stops tracks and checks deliberately,
  emits no failure event, and is idempotent. Construct a new controller to return.

Each input reports `unchecked`, `checking`, `passed`, `denied` or `unavailable`,
its generation, local selection/actual device identity and a safe reason.
Both current checks must pass for `devicesPassed`. Never persist or transmit
raw device IDs, snapshots containing them, captured media or permission errors.
Device identity serves only local selection and disappearance checks.

Selection changes, track ending, device disappearance and permission denial
clear local eligibility. Late generations cannot restore it. Track-ending
and permission events invalidate immediately; polling also detects an externally
stopped preview track. Publication muting (`track.enabled = false`) is not loss
of capture health. Unsupported permission-query APIs fall back to track health.
Intentional transition teardown must not dispatch an accidental unready intent.

ROOM consumes the real snapshot and separately tracks `unreadyPending`. On a
reasoned device invalidation, it blocks Ready/Launch and submits current-version,
deduplicated CAP unready. Failure/offline remains unconfirmed until authoritative
acknowledgement or reread; retry/conflict recovery must not restore stale consent.
Neither local passed checks nor a resolved local promise establish server Ready.
SSR/no JavaScript supplies no passed checks; judges have their native no-JS path
and bot eligibility is server-owned.

Only `/rooms/:id` allows self camera/microphone through Permissions-Policy;
other routes deny capture. Local preview joins no LiveKit session and mints no
token. A frozen scheduled Round receipt is not active media authority. Historical
segment-bound transcript capture, grants and workers are separate producers.

`device-checks.e2e.ts` runs the real controller in an isolated browser harness
with controlled Chromium devices and origin-scoped permissions, plus resolved
production headers. It does not prove ROOM Ready/Launch composition, physical
hardware acceptance or the owner-signed media design. Those remain separate
proofs. The harness has no outbound media connection and contains no fake passed
check assignment.

API references: [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/),
[Web Audio](https://www.w3.org/TR/webaudio/),
[video frame callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).
