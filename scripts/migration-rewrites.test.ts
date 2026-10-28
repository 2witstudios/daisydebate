import { assert, setupRitewayBun, test } from 'riteway/bun';
import { findRewriteProblems } from './migration-rewrites';

setupRitewayBun();

const roomClosedStatus = await Bun.file(
  new URL(
    '../packages/db/migrations/20261027214801_room_closed_status/migration.sql',
    import.meta.url,
  ),
).text();
const codes = (sql: string, proven = false) =>
  findRewriteProblems({ tag: '20990101000000_change', sql, proven }).map(
    (problem) => problem.code,
  );

test('a new migration that rewrites existing rows needs a seeded proof (ISSUE-788)', () => {
  assert({
    given:
      'an UPDATE, a DELETE and an INSERT into existing tables with no integration test naming the migration, and the same UPDATE once one does',
    should: 'fail each unproven rewrite and pass the proven one',
    actual: [
      codes(`UPDATE "rooms" SET "status" = 'closed' WHERE "status" = 'x';`),
      codes(`DELETE FROM "bot_profiles" WHERE "actor_id" = 'a';`),
      codes(`INSERT INTO "formats" ("id") VALUES ('f');`),
      codes(`UPDATE "rooms" SET "status" = 'closed';`, true),
    ],
    expected: [
      ['UNPROVEN_REWRITE'],
      ['UNPROVEN_REWRITE'],
      ['UNPROVEN_REWRITE'],
      [],
    ],
  });
});

test('rows a migration creates, and statements inside function bodies, are not rewrites', () => {
  assert({
    given:
      'reference rows inserted into a table the same migration creates, and a trigger function whose body updates a table',
    should: 'need no proof',
    actual: [
      codes(
        `CREATE TABLE "bank" ("id" text PRIMARY KEY);--> statement-breakpoint\nINSERT INTO "bank" ("id") VALUES ('a');`,
      ),
      codes(
        `CREATE FUNCTION touch() RETURNS trigger AS $$ BEGIN UPDATE rooms SET status = 'x'; RETURN NEW; END $$ LANGUAGE plpgsql;`,
      ),
    ],
    expected: [[], []],
  });
});

test('a rewrite followed by DDL on the same table must flush deferred triggers first (ISSUE-788)', () => {
  assert({
    given:
      'room_closed_status as committed, the same with SET CONSTRAINTS ALL IMMEDIATE before its ALTER, and DDL on another table',
    should:
      'flag only the committed migration: its UPDATE queues the deferred rooms trigger and the ALTER then fails on pending trigger events',
    actual: [
      codes(roomClosedStatus, true),
      codes(
        roomClosedStatus.replace(
          'ALTER TABLE "rooms" ADD CONSTRAINT',
          'SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint\nALTER TABLE "rooms" ADD CONSTRAINT',
        ),
        true,
      ),
      codes(
        `UPDATE "rooms" SET "status" = 'closed';--> statement-breakpoint\nALTER TABLE "rounds" ADD COLUMN "x" text;`,
        true,
      ),
    ],
    expected: [['PENDING_TRIGGER_HAZARD'], [], []],
  });
});
