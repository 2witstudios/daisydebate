# 0155: A Room's division is its lobby's

Status: accepted (owner decision 85, 2026-11-18; slice YLS S1 + S2,
[plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/hw2qw76pqfg7129vwteleik0),
epic [Plan — youth-lobbies](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/rvkfigx2w9tkwio3hc0uqhhk)).
Amends [ADR 0147](0147-ladder-style-and-division.md) §4, §5 and §6.

## Context

ADR 0147 kept one lobby for everyone and let a ranked Room's ladder follow
who sat: unset until a debater sat, one division, or mixed, in which case
the Round played casual. Every Room, Round, result, challenge and rating
therefore had to name its ladder ("Open – Freestyle", "Youth – Freestyle"),
and minors and adults met labels that did not apply to them. Casual Rooms had
no division at all.

Owner decision 85 replaces that with two lobbies, Open and Youth. A member
lands in their own (18 and over Open, under 18 Youth) and can switch to
browse the other. A Room belongs to the lobby it was created in, casual
Rooms included, and its debater seats are for that lobby's members.

## Decision

1. **Words.** The two lobbies are the ADR 0147 divisions (`open`, `youth`)
   as members browse them. They are not the `lobbies` table, which stays the
   container every Room lives in (standing or tournament). Code names the
   stored concept a division and says "lobby" only at the switch.
2. **Storage.** `rooms.division` is set when the Room is created and never
   changes (CHECK from `ratingDivisions`, trigger `rooms_division_immutable`).
   A ranked Round rates on its Room's division (`roundCompetition(room)`);
   `rounds.ladder_division` stays its frozen copy. `challenges.division` is
   set on every challenge: the lobby both members share. Rating storage is
   untouched.
3. **Creation** (`roomLobbyAtCreation`, decided in the create transaction
   under the creator's account lock). A member creates in their own lobby.
   Club staff (the owner of an open club, or an active member of an open
   school club holding `school.roster.manage`) may also create a Youth Room
   for their students, from either lobby. Any other choice is refused
   `other-division`. A challenge's Room opens in the pair's lobby, a rematch
   in its Room's, a tournament Room in its event's age division and a league
   ladder Room in its league's.
4. **Seats** (`seatAllowed`). Judge seats take anyone, so minors may judge
   Open Rooms and adults Youth Rooms. Debater seats, ranked and casual, take
   only the Room's division, whether claimed or assigned by the host. A
   member with no age record debates only in an Open casual Room. A bot
   debates only casually. The refusal is `other-division`.
5. **Reads and display.** The Lobby lists one division (`?lobby=open|youth`,
   default the viewer's own, plain links that work without JavaScript); the
   Division filter is gone. Inside a lobby no Room, Round, result, challenge,
   rating, profile, home or rail names a division; the leaderboard keeps an
   Open | Youth switch landing on the viewer's own. Challenges stay inside
   one lobby: a member of the other lobby is offered none.
6. **Watching** (`canWatchLive`). Every lobby row offers Watch beside its
   action ("Spectate" is renamed Watch). Any member may watch an Open Round
   live. A Youth Round is watched live only by its own audience: its seats
   and its seatless host. Its debaters' linked coaches and parents join that
   audience with ADR 0150 §4's amendment (YLS-7); until then a live Youth row
   offers no Watch outside it.

## Backfill

Existing Rooms take, in order: their launched Round's `ladder_division`; a
league ladder Room's league division; a tournament Room's
`entry.age_division` lobby setting (Open by default); else the host's
division from the birth month read at migration time; else Open. Unanswered
casual challenges, which held no lobby and could cross lobbies, are
withdrawn; answered ones take their Room's division.

## Consequences

- Removed outright: `seatedDivision`, `divisionForSeatedDebaters`,
  `roomLadderOf`, `SeatedDivision`, `rankedSeatClaimRefusal`, the
  mixed-ages-plays-casual path and its copy, the ladder badges on Rooms and
  rows, and the `ranked-division` refusal (now `other-division`).
- ADR 0147 §3 (who a member is), §1 (vocabulary) and §2 (ratings, seasons,
  Rounds) stand.
