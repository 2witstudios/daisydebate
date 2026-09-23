-- ACTOR-1 (ADR 0029, plan revision 4.10): before this leaf, nothing created
-- `actors` rows for real users; the onboarding claim in
-- apps/web/src/features/account/username.ts now inserts one transactionally
-- when a username claim succeeds. This is the one-time catch-up for users
-- who claimed a username before that code shipped.
--
-- cuid2 cannot be minted in SQL (see 0002_open_solo.sql), and ADR 0018
-- requires application-boundary minting for every identifier this
-- repository writes going forward. This backfill is the one documented
-- exception ADR 0018's own acceptance criteria carve out for migration
-- code: a one-time historical catch-up, not a runtime write path. It uses
-- PostgreSQL's own `gen_random_uuid()` (built in since PostgreSQL 13, no
-- extension required, CSPRNG-backed — never `random()`), stripped of its
-- dashes and truncated to the first 24 of its 32 lowercase hex characters,
-- which satisfies the repository's identifier shape
-- (`^[a-z0-9]{24}$`, ADR 0018) without the database ever running the real
-- cuid2 algorithm. Every write after this migration goes through
-- `claimUsername`'s injected id source instead.
--
-- Only users who completed onboarding (`username is not null`) get an
-- actor: a human actor with no username has nothing to be competitively
-- identified by yet, and the same predicate excludes tombstoned users for
-- free (`users_tombstone_scrubbed` forces a tombstone's username to NULL).
-- `ON CONFLICT (user_id) DO NOTHING` against `actors_user_id_unique` makes
-- the statement idempotent: reapplying it inserts nothing for a user this
-- migration already backfilled, or one who claimed a username after
-- ACTOR-1 shipped and already got an actor transactionally.
INSERT INTO "actors" ("id", "kind", "user_id")
SELECT
  substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  'human',
  "users"."id"
FROM "users"
LEFT JOIN "actors" ON "actors"."user_id" = "users"."id"
WHERE "actors"."id" IS NULL
  AND "users"."username" IS NOT NULL
ON CONFLICT ("user_id") DO NOTHING;
