# Round platform incident

A platform incident is the server seeing Daisy's media platform fail during a
Round. The Round's clock holds, everyone is told why, and the Round resumes or
ends by itself. No player can cause, hold or end one. It is not a pause request.
The decision is [ADR 0110](../decisions/0110-disposable-vendor-room.md).

## State

`rounds.runtime_state.incident` is one state: `none`, `paused` (since, cause,
resume point) or `resuming` (the same, and the instant the countdown ends).

The transitions are a table in `packages/debate-engine/src/round-incident.ts`:
every event is defined from every phase, and one that means nothing there changes
nothing. `advanceRoundClock` obeys the state, so every caller and the browser's
own engine do too. The clock itself applies the resume at the countdown's own end,
so a late tick cannot shorten or lengthen anything.

## Time

A speech's end has one rule: `segmentDueAtMs` in `@daisy/protocol`, and in SQL the
generated column `round_segments.due_at`. A row keeps its rule's `duration_ms`,
which hydration requires, and gains `returned_ms`. PostgreSQL refuses
`timestamptz + interval` in a generated column because it is only stable, so
`due_at` reads the small immutable function `round_segment_due_at`. Adding whole
milliseconds does not depend on the time zone.

Closed segment rows and strike rows are immutable, so a countdown, a strike window
and prep cannot take returned time. A finished incident's span stays in
`runtime_state.clock_stops`, and those waits read their deadlines through
`dueAfterStops` and `runningMs`. Attendance reads the same spans as not healthy.

## Detection

A recovery pass hands what it read of the vendor to `observeIncident`
(`apps/web/src/features/round-incidents/observe.ts`). A pure decision
(`round-incident-decision.ts`) reads it under the Round lock:

| Evidence                                                 | Means                       |
| -------------------------------------------------------- | --------------------------- |
| The pass retired an uncertain room                       | Pause, `room_retired`       |
| The vendor unreachable past a short bound                | Pause, `vendor_unreachable` |
| An empty list when the last pass saw the capture agent   | Pause, `room_emptied`       |
| The platform back, and every seat back or the grace over | Begin the countdown         |
| The recovery bound passed with the platform still down   | End the Round               |

A healthy pass takes no Round lock. A planned drain produces none of this. One
person's network loss cannot either, because capture and the other seat remain.

## What it touches

- **Speaking.** The interval closes at the resume point and a new one opens at the
  countdown's end, so the outage is not expected capture. The resume point is
  the end of the holder's last `transcript_observations.observed_until`, or
  `credited_until` for a bot seat.
- **Commands.** Every Round command and strike is refused while held, and a
  moderator's restriction does not forfeit: attendance decides that seat later.
- **Attendance.** Adjudication holds while an incident is open, because its rows
  are immutable. Afterwards the span is not healthy time.
- **Capture.** A vendor room lost inside an incident's span is excused. One outside
  it still reads as `session-interrupted`.
- **Bots.** The job stops at the hold and publishes the rest of the same answer,
  with no new model call. The publisher reads the segment's end at each publish,
  since a resumed speech ends later.
- **Charging.** A Round the platform ended refunds what it counted, once, on its
  own path, even after a served call.

## A gap that survives

The freeze measures the speech a Round owed and lost, on
`round_transcript_freezes`. The AI judge is dispatched unless capture falls below
`roundIncidentPolicy.maxCaptureGapShare`, and each gap reaches its prompt in plain
words. A shortfall nobody measured cannot be proven small. An AI-only Round past
the limit records a `capture_below_limit` incident and refunds; a human judge
heard the Round live and still rules.

## Rate and alert

The opening transaction's caller logs `round.incident.opened` and reports once
through the scrubbed error tracker, which is the operator alert. `bun incident:rate
[days]` prints incidents per 1,000 Round-hours from `round_incidents`, and capture
coverage from the freezes. `round_incidents` holds Round ids and instants, no
personal data.

## Provisional

Every value in `roundIncidentPolicy` is provisional until the failure drill sets
it. No node has been killed against this path yet.

## Known limits

- A speech that reaches its due instant before the outage is detected closes
  normally. Its lost audio stays a capture gap, not returned airtime.
- With several speakers, as in cross-examination, the resume point is the latest
  confirmed audio of any of them.
