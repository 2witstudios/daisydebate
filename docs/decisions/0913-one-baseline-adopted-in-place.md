# 0913: One baseline, adopted in place

Status: proposed (RECON-5.1 and RECON-5.2, Plan — reconcile stage 5;
decision D8 defaults to yes). Amends [ADR 0023](0023-greenfield-baseline.md)
and [ADR 0038](0038-drizzle-1-baseline.md).

## Context

Measured at main `334bbc8ac`: `packages/db/migrations` held 153 folders
(105 MB with snapshots) for a product that has not shipped, 39 of them under
names drizzle-kit drew (`dark_silver_centurion`). The schema's 146 functions,
136 triggers, 77 policies and 201 grants exist only in migration SQL, so a
baseline cannot be generated from the Drizzle schema. About 60 integration
suites replayed old folders by tag to prove how each one moved data.

ADR 0023 and ADR 0038 allow a history rewrite only as a squash that resets
every database, and they record the replaced tree's fingerprint. Staging now
has testers and data, so a reset is no longer free, and main gains folders
daily, so a fingerprint of the whole base tree goes stale the same day.

drizzle-orm 1.0 decides a pending folder by its name. Production start-up
(`startup-schema.ts`) requires the image's `(hash, created_at)` list to be an
exact prefix of the journal.

## Decision

1. **One baseline read from the catalog.** `20261121235720_baseline` replaces
   every folder through the cut-off `20261121235720_guardian_pending_friend_holds`.
   `packages/db/scripts/generate-baseline.ts` builds a database the old way
   (the superseded folders from git, applied as the old migrator applied
   them), reads it back with `pg_dump`, makes it owner-free and
   transaction-local, and refuses to write a baseline whose own catalog
   differs. Where `pg_dump`'s text for a CHECK parses to another tree (a
   `BETWEEN` stores a nested AND), the baseline carries the authored text.
   Its snapshot is the cut-off's, made the chain's origin, so folders after
   the cut-off apply on top unchanged.
2. **Proved by the catalog, not by replay.** `readSchemaCatalog`
   (`packages/db/src/schema-catalog.ts`) reads schemas, extensions, types,
   tables, columns, constraints, indexes, sequences, views, functions,
   triggers, rules, policies, every privilege, default privileges, comments,
   owners and the roles they name. `baseline-catalog.integration.ts` builds
   both databases and fails on any catalog entry or reference row that
   differs. Replay suites whose proof that comparison covers are deleted; a
   current-schema behaviour they also proved is kept against the baseline.
3. **The sanction names its cut-off.** `policy/migration-baselines.json`
   records the baseline's tag, the cut-off, the commit and the fingerprint of
   the superseded folders as the base holds them. `bun migrations:check`
   excuses exactly those folders, requires the baseline to be the branch's
   first, and still holds every base folder after the cut-off to its history.
   It is inert once the baseline is on main. A folder named from drizzle-kit's
   own word lists fails `GENERATED_NAME`.
4. **A database with data adopts the baseline in place.** `bun
db:adopt-baseline` (owner only) builds a reference database from the image:
   the baseline and exactly the later folders the live journal records. Then,
   in one transaction on the live database, it locks the journal, requires it
   to be the superseded history followed by image folders, requires the live
   catalog to equal the reference's, deletes the superseded journal rows and
   records the baseline in the first of their ids. It refuses on any
   difference and writes no table row. This replaces "reset every database"
   for staging and production; local and test databases still reset once.
5. **A deploy crosses the swap with no overlap.** No image passes start-up on
   both sides of the swap. An old image needs the superseded rows and a new
   one needs the baseline's. The owner pauses the staging deploy workflow,
   merges, and runs the adoption from the merge commit's migrator image. Then
   the release runs: the migrator (with nothing pending) and the runtime
   images from that commit. Machines already running keep serving, because
   the check runs only at start. None may restart between the swap and the
   new image's start, and rolling back past the swap is a forward fix.
6. **Temporary by design.** The generator, the old-way builder, the
   superseded journal list, the catalog-comparison suite and the adoption
   command exist only until staging and production have adopted. Their
   removal is a tracked task, not a comment.

## Consequences

- One 1.2 MB folder in place of 105 MB; reviews of a migration read SQL
  written for this schema, not history.
- Every local and test database resets once (`bun db:reset`, `bun slot:up`).
- Staging keeps its data. The owner runs the adoption, and no agent runs any
  command against staging or production.
- Folders that land on main after the cut-off apply on top with no re-cut.
- Until a database adopts, a release of this image to it fails at the
  migrator (the baseline's first statement finds its objects present) and
  rolls back, so the previous release keeps serving. This is the one
  migration that can refuse a deploy, which is why the runbook pauses the
  deploy workflow first.
