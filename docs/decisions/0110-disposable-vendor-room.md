# 0110: A vendor room is disposable

Status: accepted by the point guard on the owner's behalf, 2026-11-03. Amends the
uncertainty rules in [ADR 0053](0053-live-video-self-hosted-livekit.md) section 3.
Plan: [Media resilience](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/dhe6qaazttq79tnn38dpcp0w).

## Context

ADR 0053 says a vendor write with an unknown outcome blocks admission until it is
resolved, and that restart never clears the uncertainty. It named no way to resolve
one. A call that fails on a dead node has already rejected, so nothing can ever settle
it. One lost permission call therefore closed a Round's media for the rest of the
Round, with no way back.

Measured on two local LiveKit v1.13.7 nodes sharing Redis, by killing one:

- The survivor keeps listing the dead node's rooms, and answers their participant
  lists with 200 and empty. Listed does not mean alive.
- A permission update on such a room answers 404. A delete answers unavailable, or
  `could not find object` once the node has returned under a new id.
- A join through the survivor works and moves the room to a live node, 6 of 6. A create
  does the same, and a delete then succeeds.
- LiveKit stops choosing the dead node within about 3 s. Against a frozen node the
  survivor takes 3.07 s to answer, and a direct call hangs past 8 s.

## Decision

**A vendor room is disposable; the media session is not.** When a room's state is
uncertain, the session retires it and takes a fresh opaque name. Seats and identities
stay. Capture leases bump their epoch, so capture relaunches into the new room.

**A retirement fences uncertainty; it does not resolve it.** An intent still pending
settles as `superseded`, which claims nothing about what the vendor did. Every token
issued from then on names the fresh room, so a late write can reach only the retired room
and never the room the session now uses. The retired room is not sealed: a token issued
before the rotation stays valid for up to 60 s, and on a partitioned node a client can stay
connected there. A late acknowledgement cannot rewrite the outcome.

**When.** At once on observed absence, or once uncertainty is 6 s old by the PostgreSQL
clock: the 5 s the adapter waits on one call, plus 1 s. Restart still clears nothing,
since the age comes from the durable record. Before that bound, admission and opening
stay refused as ADR 0053 requires. A terminal session ends only on observed absence, since an end stops every later delete
attempt, and the reclaiming delete can reach a stale room. The Round itself is already
over and does not wait for this.

**What stays behind.** The 6 s does not bound the provider: a reclaiming delete can make three calls of 5 s, so
a late create can still appear under the retired name. An empty late-created room closes itself by `empty_timeout`. A
client still in a retired room on a partitioned node can talk only to others there: no
capture, judge or floor reaches it.

**Node list.** `LIVEKIT_URL` and `LIVEKIT_PUBLIC_URL` each take one or more nodes, comma
separated, in matching order. One entry behaves as one node always did. Reads move past a
node that faults, since asking twice changes nothing. A write goes to one node, since a
second attempt could not tell what the first did. A probe every second decides which node
clients join through. With none healthy every node is still tried, because a probe can be
wrong. Any node reaches any room through LiveKit's Redis.

**A blip is not a drop.** The browser SDK resumes the same connection for up to 5 s with
its tracks. Past that it is a drop and joins the one recovery loop.

**Where the rule lives.** `mediaRoomFate` in `@daisy/debate-engine` is the one decision, with
one outcome per variant: keep, end, rotate with its cause, or clear. The store supplies
PostgreSQL's time and the rows, and applies the result. The bound is one vendor call's
timeout from `@daisy/media` plus 1 s, derived where the rule is composed.

## Consequences

- A lost call now costs one rejoin, not the Round's media.
- Every unsafe episode rotates the room, so everyone in it reconnects, even after a blip
  that a read-back might have proved harmless. Chosen for one rule over a cheaper path.
- `media_vendor_mutations.outcome` gains `superseded`.
- `capture-session-history` treats a room change inside a segment as an interruption, which
  the platform incident (SFU-12) must excuse.

## A lost room

LiveKit has no room migration, so a node's death ends its rooms. Through a surviving node,
a dead node's room still lists as occupied under the same id for over 12 s (measured), so no
listing shows the loss, and a seat signalling through the survivor hears nothing for about
15 s, until ICE fails. While the node probe says a node is down, each pass makes a call only
the room's node can serve: a same-value metadata update, 50 ms when live, `unavailable` from
the moment it is dead (measured). A lost room rotates, which opens the platform incident,
whose checkpoint change rings the doorbell, so every seat rejoins a fresh room at once.

Nodes alone do not keep a Round alive. This does.

**Limit:** each affected Round spends up to 2 s of a pass on this, at four passes at a time per
process. Not measured at 50 Rounds.

## A platform incident holds the Round

A node outage the server detects holds the Round's clock. No player can cause, hold or end it. When the platform and every seat are back, or a grace ends, the Round resumes on an automatic countdown from the speaker's last confirmed audio. Past a recovery bound it ends as a platform incident: no outcome, no rating, no penalty, no charge.

**The state is one value on the checkpoint:** `none`, `paused` or `resuming`, moved by a table of pure, total transitions, and at a countdown's end by the clock's own `resumeIfDue`, so a late tick cannot shorten anything. `advanceRoundClock` obeys it, so every caller and the browser's own engine do too.

**A speech's rule duration never changes.** Hydration refuses a row that disagrees with its rules, so a row gains `returned_ms` beside it. A speech's end has one rule in TypeScript and one generated column in SQL.

**Rejected: writing returned time onto every wait.** Closed segment rows and strike rows are immutable, so countdowns, strike windows and prep read finished stop spans from the checkpoint through one rule instead. This is also what attendance reads as not healthy, through the existing effective-deadline rule.

**Rejected: `started_at + duration_ms * interval` as the generated column.** PostgreSQL 18.3 refuses it as not immutable. `due_at` reads an immutable function, which is true of whole milliseconds, and was measured correct across a daylight saving change in three session time zones.

**Adjudication holds while an incident is open**, because its rows are immutable and a wrong forfeit cannot be undone. A moderator's restriction does not forfeit during a hold; the restriction stands and attendance decides the seat afterwards.

**A small gap that survives is judged and stated.** The freeze measures what was owed and lost. The AI judge rules unless capture falls below a limit, and the gap reaches its prompt in plain words. This replaces the rule that any incomplete transcript withholds the AI judge (DEC-208 for AI panels). A shortfall nobody measured cannot be proven small. Unheard speech decides whether AI may rule; the platform's own loss decides whether it ended the Round. An AI-only Round whose platform loss is past the limit is marked `platform_ending = capture_shortfall`, stays `completed` with no outcome through the existing panel path, and refunds. A debater's silence past the limit takes the transcript-incomplete path: no blame and no refund, but no outcome and no rating either. So does a platform loss under the limit that silence tips over. The one exception is silence inside a stream taken over mid-speech, which counts as the platform's because gaps carry no capture epoch: it needs an outage in that speech and long silence, and gives a refund, never a false rating (ISSUE-1317).

**A speech starts when capture has its speaker.** A later speech publishes a fresh microphone, so at the clock capture had nothing for up to 0.9 s on staging, and a person starting at once lost their first word. Three things close it, and no floor change grows when capture is on time. The next human speaker's microphone opens `roundStartPolicy.microphoneLeadMs` before the clock, the shortest that measures reliably, and the seat is told first because the other side can hear it. Capture reports a track on subscription, with no open segment needed, since a silent microphone may send no frames. The pass that opens the microphone records a start gate on the checkpoint naming who is awaited: at the due instant, if capture has not reported them, the clock holds until it does, bounded by `captureHoldBoundMs`, then starts anyway. Capture failing never stalls a debate. A late start is the clock's own anchor, so seats, judges and audience read one instant. Audio before the clock never enters the transcript: capture admits a frame only inside a speaking interval, and frames that beat its own history wait in memory for about a second while history reads run. It never reaches Egress either: the stage subscribes to a voice only while a speech's clock runs, so a Broadcast's start can lose what subscribing takes, and no timing error at a speech's edge can publish the lead.

**A speech out of prep gets the same lead.** The microphone stays shut through in-round prep, so prep stays private. When prep ends, by the seat's button or by running out, the checkpoint records `prep_ended_at`, and the clock starts `microphoneLeadMs` later with the microphone open for that lead and the same start gate. Prep cannot restart inside that lead.

**Every gap capture can measure is stated.** Each closed stream's gaps reach the transcript, and reach the judge with a cause: `platform`, `edge` for a speech's start or end before or after capture was reading, or `unattributed`, worded neutrally because it may be a silent seat. Edges decide nothing, or a Round of short speeches would lose its AI judge to them.

**Provisional:** every bound in `roundIncidentPolicy`: 5 s vendor-unreachable, 30 s seat grace, 90 s recovery, 5 s countdown, and `maxUnheardShare`, 5%. The drill sets them. None was measured.
