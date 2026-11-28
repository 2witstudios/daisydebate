# 0936: Points of information, one prep state, and commands that name their segment

Status: accepted (owner decisions of 2026-11-26 and design review of the
"Prep, POI and cross-examination" canvas; slice round-interaction, tasks
INTX-1 to INTX-21). Supersedes the interruption policy of
[ADR 0096](0096-cross-examination-open-microphones.md) and the POI paragraph
of [ADR 0092](0092-room-creation-resolution-selection.md). Amends §8 of
[ADR 0058](0058-one-round-model.md) (bots take no prep) and closes ISSUE-871.
Amends ISSUE-1013 (either partner calls prep).

## Context

The clock was already deterministic: database time is the only clock, the
engine (`stepRound`) is pure, and every expiry is stamped at its due instant.
But the rules around it were wrong in four places:

- **Prep could not be taken** with a countdown of 0. Its window was about 9 s,
  only the scheduled speaker could take it, and a seat that left stranded it.
- **Ending cross-examination early** credited the unused time to prep.
- **A late "End"** could close the asker's next speech, because no command
  said which segment it meant.
- **There was no real point of information.** `enabled` let a debater take the
  floor for as long as they liked with no accept step. `open` opened every
  microphone for the whole speech.

## Decision

### Points of information

A point of information is offered, then accepted or declined. A format offers
it within bounds and a Room chooses it on or off:

```
interaction.pointsOfInformation:
    { allowed: false }
  | { allowed: true, protectedStartMs, protectedEndMs, maxDurationMs, offerLapseMs }
```

The defaults are the parliamentary ones: 60 s protected at each end of a
speech, 15 s for a point, and 10 s before an unanswered offer lapses. Daisy
bounds them: protected time 0–120 s, a point 5–30 s, and a lapse 5–30 s.

- **Where.** Only a speech with one speaker takes points: never
  cross-examination, and never a segment shared by both sides.
- **Who offers.** A present human debater on a side other than the speaker's
  may offer, outside the protected start and end, while no point is being
  given, and once at a time. The speaker's partner never offers.
- **Who answers.** The speaker accepts one offer, which drops the others, or
  declines them all. The offerer may withdraw.
- **During a point.** Both the speaker's and the holder's microphones are
  live, so the speaker can take the floor back. The holder ends the point
  with "End POI" and the speaker with "Resume speech". Otherwise it ends by
  itself at `accepted_at + maxDurationMs`.
- **The clock.** The speech clock keeps running throughout, as in a real
  round.
- **Time.** Offer lapse, the end of the window and a point's end are clock
  events. `advanceRoundClock` applies each at its exact instant, before any
  segment close due at or after it. Incident stops shift them through the
  same `dueAfterStops` as every other instant.
- **What ends a point early.** A segment close, a pause and the holder
  leaving each end any point. Leaving also withdraws that seat's offers.

The checkpoint holds one union in place of the floor:

```
point_of_information: { phase: 'none' }
  | { phase: 'offered',  offers: [{ participant_id, offered_at }] }   // ≥ 1, unique
  | { phase: 'speaking', holder_participant_id, accepted_at }
```

### Prep is one state

`active_prep` and `prep_ended_at` become one union:

```
prep: { phase: 'idle' }
    | { phase: 'called',  side }              // called during the segment before
    | { phase: 'running', side, started_at }
    | { phase: 'lead',    ended_at }          // the microphone lead after prep
```

- **Calling ahead.** Prep may be called during the segment before the one it
  is for. The close of that segment turns it into `running` at the close
  instant exactly, so a countdown of 0 works.
- **Who calls.** Either partner on the side may call, start or end it.
- **Leaving.** When no present partner remains, a called prep is dropped and
  a running one ends at once, charged to the side.
- **Bots** never take prep. A human partner may call prep for a bot's speech.

### Cross-examination

- **No refund.** Only an early-ended speech returns time to prep. Ending
  cross-examination early returns nothing.
- **Who ends it.** The asker may always end it, whatever the yielding rule.
  When the asker is a bot, which never ends one, a person on the answering
  side may.
- **A named, sided asker.** A newly authored format names each
  cross-examination's asker, a seat of a side. Only authoring checks this
  (`authoredFormatDefinitionSchema`, used by custom creation and
  `update-format`). A format, Room or Round stored before the rule still
  parses, and its unled cross-examination runs as the open exchange it always
  was.
- **Bots in a team.** Only the asking side is owed an answer, and on the
  answering side only its lowest seat's bot answers.

### Commands name their segment

Every floor command carries `sequence`. That is the segment it acts on (yield
and the POI commands) or the segment it is for (prep). A press naming any
other segment is refused as stale (CONFLICT), so a late "End" never closes the
next speech, and a press that loses a race to the clock is a conflict, not an
illegal move.

The commands are `start_prep`, `cancel_prep`, `start_speech`, `yield`,
`offer_poi`, `withdraw_poi`, `accept_poi { offererParticipantId }`,
`decline_poi` and `end_poi`. `interrupt` remains in `round_commands.type`
only as history.

## Why

- **The real round.** These rules match a parliamentary and policy round.
- **One state, not parallel fields.** Each union holds one fact, so no
  combination of fields can contradict another. Hydration refuses a running
  prep beside an open segment, a called prep without a next segment, and a
  point in a segment that takes none.
- **Legality in one place.** `round-command-legality.ts` alone decides what is
  legal, and the browser offers exactly those options through
  `roundControlsAt`. The engine's contract walks fail if it ever refuses an
  option the browser offered as legal.

## Consequences

- **No points against a bot speaker,** and bots never offer. A bot cannot yet
  hear a question and answer it; that is ISSUE-1543.
- **Ranked play takes no points of information.** Every preset is off;
  templates keep the choice.
- **Formats not yet covered.** WSDC reply speeches (ISSUE-1541) and BP benches
  (ISSUE-1542) need their own rule.
- **A bot restarted mid-cross-examination** may miss a question it was
  answering, though it never answers one twice. This is INTX-20, filed as an
  issue while bots are behind their release flag.

## The migration

A forward migration rewrites stored format revisions, presets, Rooms, Round
snapshots, league `room.floor` settings and every version-1 checkpoint:

- **Definitions:** a format that offered any interruption choice offers points
  of information within Daisy's bounds.
- **Settings and rules:** `enabled` and `open` become points of information at
  the defaults, and `disabled` becomes off.
- **Checkpoints:** prep keeps its state and its spend, and any interruption
  floor returns to the speaker.

Unlike ADR 0096's migration, this one never refuses: a migration must never
block a deploy. A Round live across the release keeps its prep, and at worst
loses an interruption that was in progress. Its history stays in
`round_speaking_intervals` and the command log, which the migration leaves
alone.

That is an accepted loss with a known shape. If a Round holds an interruption
floor, or runs a speech under `open` questioning, when the migration commits,
the engine and media grants return to the scheduled speaker at once. The open
`round_speaking_intervals` row, however, still names the interrupter, or
every debater, until that one segment closes, so for its remaining seconds
the speaking record disagrees with who has the microphone. Both modes were
unranked custom choices, the window is at most one segment, and the next
speakers change or segment close writes the true record. Rewriting intervals
from SQL, which cannot run the engine's speaking rule, would risk a worse
record than the one it replaced.
