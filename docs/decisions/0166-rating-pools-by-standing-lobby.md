# 0166: Rating pools belong to standing lobbies

Status: accepted by ADR 0162 and master-plan tasks LL-2.1–2.3. Amends
[ADR 0135](0135-leagues-are-organizations.md) and
[ADR 0147](0147-ladder-style-and-division.md).

A standing lobby owns its ladders and one active season. A Round freezes
its own lobby's ladder and active season together at Start. Every rating
posting names that pool and an eligible competitor on the Round. The ledger
retains posted states and timestamps, and each projection uses the same
actor, ladder and season identity. Historical postings keep their original
season where it belongs to their Room's lobby. Where several standing
lobbies shared an old rating period, the other lobbies receive their own
copy of that period and each posting follows its Room. The original season
retains its waiver signatures and sanction receipts. League-managed seasons
start with the standard initial rating. The operator CLI retains its
rollover guard while DEC-111 remains open.

All eligible standing-lobby Rounds use the same posting transaction. A
league's configured Room selection and the ranked preset path both resolve
to the same frozen pool. Each member of a two-sided team rates against the
opposing side's mean pre-game state after inactivity widening. The
head-to-head case uses the same calculation.

Certified tournament results still need replay. The correction scenario in
`apps/web/integration/league-rating-correction.test-support.ts` supersedes a
certified record, requires the league standings to replace the old result
rather than count a second game, and requires an existing draw's retained
rating snapshot to survive both correction and rollback. Replaying the
receiving season's corrected certification alongside its own Rooms
preserves the effect on later competitive inputs. Room inputs keep ledger
posting order, including games settled after subsequent Rounds. A season
with no rateable effective certification reads the shared projections. The
official leaderboard replays only public Room postings and certified
tournament decisions released to the public. The league view follows its
authorized audience. A receiving league's sanction remains in the receiving
lobby and season, and retained tournament snapshots keep their seeded ratings.
