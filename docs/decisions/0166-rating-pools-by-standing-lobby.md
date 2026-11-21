# 0166: Rating pools belong to standing lobbies

Status: accepted by ADR 0162 and master-plan tasks LL-2.1–2.3. Amends
[ADR 0135](0135-leagues-are-organizations.md) and
[ADR 0147](0147-ladder-style-and-division.md).

A standing lobby owns its ladders and one active season. A Round freezes
its own lobby's ladder and active season together at Start. Every rating
posting names that pool and an eligible competitor on the Round. The ledger
retains posted states and timestamps, and each projection uses the same
actor, ladder and season identity. Closing the season waits for in-flight
postings. Rounds already frozen to that season can settle there afterward.
Existing postings keep their recorded season and move only to an existing
canonical lobby and ladder. The Open and Youth reference seasons use
their respective reference pools. A league season with no unambiguous
standing lobby requires an explicit adoption decision. The schema upgrade
creates no historical pool, period copy or rating posting. A Round without
a posting keeps its result and audience classification. Old completed league
Rooms do not acquire new ratings. An in-flight ranked Round without a
canonical pool requires separate handling before adoption.
Seasons opened through the league's managed standings rules start with the
standard initial rating. The operator beta path retains its activation and
posting guards while DEC-111 remains open.

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
preserves the effect on later competitive inputs. New Room inputs keep
ledger posting order, including games settled after subsequent Rounds.
A season with no rateable certified inputs reads the shared projections.
Current completed Rounds still recover through the shared ledger writer.

The official leaderboard, member cards and Room discovery use the same
public rating history. The receiving ladder reads projections, postings and
certifications from one snapshot. A Room shows each seat's rating from
its selected ladder and uses its frozen season once the Round has started.
Discovery has no host rating until that host has a published standing.
When a private or delayed result affects the stored
projection, the public calculation uses the complete released games so
later public results remain visible. An approved tournament result counts
in that view when its posting and decision have been released to the public.
The receiving league's host can include withheld certified games only when
they also have the source tournament's host-read authority. League members
and outsiders who may read the receiving ladder see the publicly released
games. A sanction remains in its receiving lobby and season, and retained
tournament snapshots keep their seeded ratings.
