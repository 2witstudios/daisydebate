# 0157: Every Round of a Youth Room is a Youth Round

Status: accepted (point guard for the owner, 2026-11-18; slice YLS-11 youth
fences, [plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/wc9u90q7multiiqjav696ekq),
epic [Plan — youth-lobbies](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/rvkfigx2w9tkwio3hc0uqhhk)).
Amends [ADR 0150](0150-youth-recordings-private.md) §1 and, through it,
[ADR 0151](0151-media-releases.md). Builds on
[ADR 0156](0156-room-division-from-its-lobby.md).

## Context

ADR 0150 defined a Youth Round as a ranked Round on division `youth`
(`rounds.ladder_division`) and left casual Rounds to ADR 0107's host opt-in
rules. ADR 0156 then gave every Room a division from its lobby, casual Rooms
included, and seats Youth Rooms' debaters from the Youth lobby only. A casual
Round in a Youth Room has no ladder, so minors' casual Rounds slipped every
ADR 0150 fence except live watching, which ADR 0156 already keys on the
Room's division: its Recording followed the Room's visibility, it could be
broadcast, listed on Live and in the public archive, read on the spectator
timeline, downloaded and shared.

## Decision

1. **What a Youth Round is.** Any Round of a Room in the Youth lobby
   (`rooms.division = 'youth'`), ranked or casual. A Round is Youth when
   either its Room or its frozen ladder division is Youth, so the rule fails
   closed. The two agree for every ranked Round since ADR 0156, and a Round
   with no Room has only its ladder. ADR 0150 §1
   is replaced by this; its "Casual Rounds keep ADR 0107's host opt-in rules"
   now applies only outside the Youth lobby.
2. **One rule, one mirror.** `isYouthRound(round, room)` in
   `@daisy/protocol` (beside `canWatchLive`) is the rule every TypeScript fence
   asks: recording composition, which sets the Round's youth people that
   permissions, takedown, download and the share panel read; capture
   eligibility; and `plannedBroadcast`. `youthRoundSql(roundId)` in
   `@daisy/db` is its SQL mirror for every SQL fence: broadcast discovery, the
   open-Broadcast youth fact and the youth-broadcast stop, the Live listing,
   its count, cursor and a Room's link to Watch, the spectator timeline, the
   public archive (scope, cursor and row), public profiles and member cards,
   the follower notice that a Recording is ready, the media-release counts and
   the publish command. No fence tests `ladder_division` alone.
3. **A casual Youth Round's Recording** is still captured only when its host
   opted in and holds the entitlement, and its eligibility stays
   `host_opt_in`: the lifecycle already lets participants remove a casual
   Recording, so it needs no `youth` fact. Its audience, takedown (youth
   debaters and their linked adults, never a judge), download refusal, share
   panel and publishing are ADR 0150 and 0151's, with two limits a ranked
   Round never meets: a Recording its host kept for the officials still shows
   its video only to them and only until its deletion date, and only a public
   Round whose Recording is released to everyone can be shared publicly (the
   publish command refuses any other as `not_available`, and the panel says
   why).
4. **Existing data.** Casual Rounds already played in Youth Rooms read as
   private from deploy. Any Broadcast one opened is stopped and its video held
   back by the existing youth-broadcast sweep (ADR 0150 §4), with ADR 0150's
   trade-off: a casual Youth Round live across the deploy whose Recording
   followed that Broadcast is recorded only up to the stop. No follower is
   told such a Round is live (the live fanout and its standing ask
   `youthRoundSql`). No publication needs a backfill: the publish command
   accepted only ranked Youth Rounds. A follower's `recording_ready` notice
   sent before the deploy stays in their inbox but links to a Round that now
   reads as missing; staging held no such Round.

## Consequences

- A host who opts a casual Youth Room into a Broadcast gets a private
  Recording only; no audience feed opens. The capture choice itself is not
  refused at the Room yet (ISSUE-1488).
- A new fence must ask `isYouthRound` or `youthRoundSql`; an integration test
  (`packages/db/integration/youth-round-sql.integration.ts`) holds the mirror
  to the rule over every Room division and ladder.
