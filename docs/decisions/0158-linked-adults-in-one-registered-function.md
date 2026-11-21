# 0158: A Youth Round's linked adults come from one registered function

Status: accepted (point guard for the owner, 2026-11-19; slice YLS-12 linked
adults' live floor chat, epic
[Plan — youth-lobbies](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/rvkfigx2w9tkwio3hc0uqhhk),
decision 86). Amends [ADR 0155](0155-linked-adults-watch-youth-live.md) §2 and
§7 and [ADR 0150](0150-youth-recordings-private.md) §3. Gives
[ADR 0129](0129-tenant-isolation-by-row-level-security.md) its first registered
`SECURITY DEFINER` functions and the check that holds them.
Amended by [ADR 0161](0161-youth-rounds-follow-open-visibility.md): the same function admits linked adults through a private or unlisted Room's Recording and live room.

## Context

ADR 0150 §3 read a youth debater's linked adults as the web role, step by
step: the debater's memberships and guardian links under the subject scope,
then each school's owner and staff under that school's scope. The realtime
role may hold no privilege on a tenant-owned table (ADR 0129 §4), so it could
not run that read. ADR 0155 §7 therefore left realtime to refuse every linked
adult: a coach followed their student's live Round through the web's polled
read, and the floor chat stayed hidden for them while realtime was up. ADR
0129 already named the way out, a registered `SECURITY DEFINER` function, but
had none and no check of one.

## Decision

1. **The rule, once, in SQL.** Two functions, owned by the migration owner,
   `STABLE`, `search_path` pinned to `pg_catalog, public, pg_temp`, and executable by
   no `PUBLIC`:
   - `daisy_linked_adult_users(user_id)` is a minor's linked adults: an adult
     (`daisy_age_band`) with an active guardian link to them, the owner of an
     open school they are an active member of, or an active member of that
     school holding a live organization grant whose role carries
     `school.roster.manage`; never the minor. Only `daisy_web` runs it (media
     releases name who hears of a withdrawn release).
   - `daisy_round_linked_adult_actors(round_id)` is a Youth Round's youth
     debaters (its current debating seats held by a person) with the actor ids
     of each one's linked adults, over the first. A Round is a Youth Round by
     `youthRoundSql`'s test (ADR 0157); any other Round has no rows. `daisy_web`
     and `daisy_realtime` run it.

   `readYouthRecordingPeople` and `readLinkedAdultUserIds` in `@daisy/db` are
   one statement each over them. The scoped step-by-step read is gone, and
   with it the read-only snapshot transaction it needed: one statement sees
   one snapshot.

2. **The TypeScript statement is the spec.** `linkedAdultsOfRound` in
   `@daisy/auth/linked-adults` states the same rule over
   plain facts. Shared fixtures (`@daisy/auth/linked-adults-testing`) hold both:
   a unit test runs them through the TypeScript rule, and
   `packages/db/integration/round-linked-adult-actors.integration.ts` seeds
   the same people into PostgreSQL and asserts that the function, run as the
   web role and as the realtime role, answers exactly as the TypeScript rule
   and the fixture do: each kind of linked adult allowed, every other adult and
   stranger refused, an Open Round with no debaters.
3. **Registered, and checked.** The tenant manifest gains `definers`: every
   `SECURITY DEFINER` function whose definition (`pg_get_functiondef`, so a
   `BEGIN ATOMIC` body too) names a tenant-owned table or a registered definer
   in any case, in any schema but PostgreSQL's own, with the
   roles that may execute it and why its output discloses no more than its
   callers may know. `tenantDefinerProblems` reports an unregistered definer
   that reads a tenant-owned table, a registered one that is missing, does not
   pin `search_path` with `pg_catalog` first and `pg_temp` last (unlisted,
   `pg_temp` is searched first, so a caller's temporary table could stand in
   for a table the function names), is executable by `PUBLIC`, or is
   executable by roles other than those registered. It runs wherever the
   table check runs (`bun doctor`, the integration suite, production
   start-up). On a database a newer migration has moved ahead, start-up checks
   only the definers it registers. The functions that already read tenant
   tables (Room chat's fact, the tournament capture admission functions, the
   hosting-version erasure, the fixture Room source trigger) are registered as
   they stand; Room chat's fact, the one pinned without `pg_temp`, is re-pinned
   in the same migration.
4. **Realtime admits linked adults.** The realtime server's people read is the
   real one, through its own 15-second people cache, so the Round topic and
   the floor's realtime permits admit a Youth Round's linked adults while it
   runs (ADR 0155 §3's lazy order is unchanged: links are read only after the
   read's own audience decision refuses). A lookup that fails still admits
   nobody: the Round topic refuses and the floor permits keep their first
   pass. The periodic reauthorization drops both topics once the Round ends.
   The floor chat is shown to them, read-only: they read it and never post,
   react or remove (DEC-174, decision 84).
5. **Unchanged.** Who is a linked adult, the live audience rule
   (`liveAudience`), the 15-second window after a revoked grant or ended
   link, the Recording's rules, and the realtime role's table privileges
   (`SELECT (division) ON rooms` only).

## Consequences

- A new cross-tenant read is a new registered definer with its executors and
  reason; the check fails a definer that reads a tenant-owned table without
  one, by design.
- The check recognizes a tenant-owned table by its name in the function's
  definition.
  A body that builds its SQL dynamically escapes it; none does today.
- The live arrival of a floor message for a linked adult is proven in the
  messaging realtime browser cohort (`support/youth-coach-floor-live.ts`);
  the default browser suite runs without realtime and proves the read-only
  floor and its history.
