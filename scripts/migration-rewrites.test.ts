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

test('the applied judge basis exception requires exact SQL, path, predecessor and named proof', async () => {
  const tag = '20261105051949_casual_judge_usage';
  const path = `packages/db/migrations/${tag}/migration.sql`;
  const sql = await Bun.file(
    new URL('./fixtures/billing-judge-basis-applied.sql', import.meta.url),
  ).text();
  const input = {
    tag,
    sql,
    proven: true,
    history: {
      path,
      predecessorFingerprint:
        'sha256:22f15babca01acf4ec7329fbbbf03620cb0ba799cc402cd1e360e77d2ce363fd',
      proofFiles: [
        'packages/db/integration/usage-count-basis-migration.integration.ts',
      ],
    },
  };
  const variants = [
    input,
    { ...input, tag: '20990101000000_other' },
    { ...input, sql: sql + '\n-- changed bytes\n' },
    { ...input, proven: false },
    {
      ...input,
      history: {
        ...input.history,
        path: `apps/admin/src/db/migrations/${tag}/migration.sql`,
      },
    },
    { ...input, history: { ...input.history, proofFiles: [] } },
    {
      ...input,
      history: {
        ...input.history,
        predecessorFingerprint: 'sha256:changed-schema',
      },
    },
    { tag, sql, proven: true },
  ];
  assert({
    given:
      'the exact counted-row proof binding and changes to each required identity or evidence input',
    should:
      'waive only that one pending-trigger false positive, never missing rewrite proof',
    actual: variants.map((variant) =>
      findRewriteProblems(variant).map((problem) => problem.code),
    ),
    expected: [
      [],
      ['PENDING_TRIGGER_HAZARD'],
      ['PENDING_TRIGGER_HAZARD'],
      ['UNPROVEN_REWRITE', 'PENDING_TRIGGER_HAZARD'],
      ['PENDING_TRIGGER_HAZARD'],
      ['PENDING_TRIGGER_HAZARD'],
      ['PENDING_TRIGGER_HAZARD'],
      ['PENDING_TRIGGER_HAZARD'],
    ],
  });
  assert({
    given:
      'a generic rewrite followed by ENABLE TRIGGER, or another hazard appended to the exception migration',
    should: 'retain the generic guard and report each affected table',
    actual: [
      codes(
        'UPDATE usage_reservations SET state=state; ALTER TABLE usage_reservations ENABLE TRIGGER usage_attribution_immutable;',
        true,
      ),
      findRewriteProblems({
        ...input,
        sql:
          sql +
          '\nUPDATE rooms SET status=status; ALTER TABLE rooms ADD COLUMN fixture text;',
      }).map((problem) => problem.detail),
    ],
    expected: [
      ['PENDING_TRIGGER_HAZARD'],
      ['usage_reservations', 'rooms'].map(
        (table) =>
          `${tag} alters ${table} after rewriting its rows; a deferred trigger on ${table} fails that DDL with pending trigger events. Put SET CONSTRAINTS ALL IMMEDIATE before it, or split the migration`,
      ),
    ],
  });
});
