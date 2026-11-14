# 0134: Formats beyond two sides: seats, speak rights, outcome kinds, ballot definitions, recording policy and one active seat

Status: accepted (owner direction for Daisy Tab, 2026-11-13: decisions 11, 12,
14, 16, 18, 24, 25, 29 and 30 on
[Daisy Tab › Direction](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/jro30yyuynd11e7qzjfdby0u);
built by slice F, [TAB-6](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/d5mdifvmb2cku23apxnnej5g),
on the parent branch of [ADR 0128](0128-feature-parent-branch.md)).

Supersedes the role vocabulary in [ADR 0029](0029-competitive-schema-foundation.md),
"one participant per side" in [ADR 0030](0030-effective-rules-and-growth-paths.md),
"four-team placement is excluded" in [ADR 0049](0049-room-debate-turn.md), and
§4 of [ADR 0070](0070-one-active-room-per-user.md). Extends
[ADR 0096](0096-cross-examination-open-microphones.md). Amends
[ADR 0033](0033-presence-and-adjudication.md) on attendance,
[ADR 0058](0058-one-round-model.md) and [ADR 0100](0100-round-completion-structure.md)
on outcomes and panels, and [ADR 0107](0107-recording-and-retention.md) on
recording. Keeps DEC-277 (no strict majority is no outcome) and ADR 0078
(formats configure structure only).

## Context

The Round kernel and the Room run one shape: two sides, one speaker per
segment (or both sides in cross-examination), one winning side and one fixed
ballot. Tournaments need panels of judges, four-team debates, speech sections
of unsided speakers and open conversation with no ballot. The kernel must run
all of them as ordinary Rooms while learning nothing about tournaments, and an
ordinary two-sided Room must behave exactly as before.

## Decision

1. **Seats.** A seat is a `side` seat (it belongs to a side), an unsided
   `speaker`, a `judge` or a `moderator`. A format declares an ordered list of
   sides, each a stored key with a label: none, or two to four. `affirmative`
   and `negative` are the two-sided preset's keys and stay valid stored values.
   A format is sided or unsided, never both. The database stores `seat_kind`
   and a `side` present exactly when the seat is a side seat; hold and
   invitation kinds are the four seat kinds.
2. **Speak rights.** Each segment states who may speak: one seat, several, or
   all (every side, speaker and moderator seat, never a judge), with a lead
   seat the segment is scheduled to. A speech has one; a cross-examination of
   today is `all` led by the asker. Microphones open for exactly those seats.
   Interruptions are possible only where one seat holds the floor.
3. **Outcome kinds.** A format's outcome is `winner`, `ranking` of sides or of
   speakers, or `none`. A Round's outcome is a winning side or ordered places,
   never both; a winner keeps its scalar column (`winning_side`) because the
   ladders and standings join on it.
4. **Panels.** A Round freezes its ballot definition with a panel rule:
   `majority` (a strict majority of submitted ballots names the winner; a tie or
   double-loss ballot names none) or `rank_sum` (ranks summed, equal sums share
   a place), and a quorum. Fewer submitted ballots than the quorum is no
   outcome, ruled `below-quorum`. Quorum 1 is today's behaviour.
5. **Ballot definitions.** A ballot definition is typed, versioned data
   (`key@revision`): its decision (winner with low-point-win, tie and
   double-loss switches, or a ranking), its points (per side, seat or speech,
   a scale with a step, a criteria grid or one holistic score, per-segment
   weights), speaker ranks and written fields. One pure function gives the one
   schema human and AI ballots validate against. Daisy's own definitions are
   `speaker-10@2` (and `speaker-10@1`, history), a side ranking and a speaker
   ranking; an ordinary Room is judged on the one its outcome kind implies.
   `speaker-10@2` accepts exactly what the ballot accepted before.
6. **The pairwise concepts stay pairwise.** Forfeit by absence, the
   resolution strike, the low-point win and ratings require exactly two sides
   and say so as a typed precondition. Outside a two-sided winner format a
   missed speech marks the seat absent and the Round continues; it is
   abandoned only when no speaking seat is present. Only a two-sided,
   one-judge, `speaker-10` winner Round is rateable.
7. **Recording policy.** A Room's recording pin is `off`, `officials` or
   `released`, frozen on its Round. Ranked is `released`. Under `officials`
   only judge and moderator seats and the host see the Recording, it carries a
   deletion date and the Room is not broadcast. An event Room is `off` or
   `officials`, never `released`. The policy governs the Recording only, not
   transcript capture, which judging needs.
8. **One active seat.** The one-active-Room rule holds a person only while
   they are seated. A host without a seat is not held and may host several
   Rooms. A hold or an invitation is not a seat.

## Consequences

- Stored formats, rules, Rooms and Rounds are rewritten once by a proven
  forward migration (ADR 0023); seats, outcomes, ballots and the rating ledger
  keep their values.
- The AI judge's messages are generated from the frozen definition and are
  byte for byte today's for `speaker-10@2`; the AI judge is seated only in
  sided formats.
- A golden corpus of the two-sided path pins compiled schedules, scripted
  Rounds, endings, rating numbers, judge messages and ballot parses.
- A `consensus` panel rule, a moderator who controls the clock, formats that
  mix sides with unsided speakers, Congress, and a rated four-team, speech or
  open format are later decisions.
