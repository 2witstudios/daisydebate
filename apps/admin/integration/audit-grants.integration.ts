import { requireTestServices } from '@daisy/config';
import { afterAll, beforeEach } from 'bun:test';
import { desc, eq, sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  appendAudit,
  readAuditPage,
  verifyStoredChain,
} from '../src/audit/store';
import { auditEvents } from '../src/db/schema';
import { schemaPowers } from '../src/db/runtime-role';
import { adminTestDatabase, testDeps } from './admin.test-support';

requireTestServices(process.env);
setupRitewayBun();
const database = adminTestDatabase();
const { db } = database;
beforeEach(async () => {
  await database.reset();
});
afterAll(() => database.close());

const append = async (count: number) => {
  const deps = testDeps(db);
  for (let index = 0; index < count; index += 1)
    await db.transaction((tx) =>
      appendAudit(tx, {
        id: deps.ids.next(),
        kind: 'auth.success',
        operatorId: 'operator1operator1operat',
        commandId: null,
        targetUserId: null,
        outcome: null,
        detail: null,
        at: deps.clock.now(),
      }),
    );
};

/** Runs `statement` as daisy_admin_app; returns 'ok' or the SQLSTATE class. */
const asRuntime = (statement: ReturnType<typeof sql>) =>
  db
    .transaction(async (tx) => {
      await tx.execute(sql`set local role daisy_admin_app`);
      await tx.execute(statement);
      return 'ok';
    })
    .catch(() => 'denied');

test('the runtime role may only append to and read the audit chain', async () => {
  await append(1);
  assert({
    given: 'daisy_admin_app against audit_events',
    should: 'allow SELECT and INSERT and refuse UPDATE, DELETE and TRUNCATE',
    actual: [
      await asRuntime(sql`select count(*) from audit_events`),
      await asRuntime(sql`insert into audit_events
        (seq, id, kind, at, prev_hash, hash)
        values (99, 'x', 'auth.success', now(), 'p', 'h')`),
      await asRuntime(sql`update audit_events set outcome = 'x'`),
      await asRuntime(sql`delete from audit_events`),
      await asRuntime(sql`truncate audit_events`),
      await asRuntime(sql`delete from chain_checkpoints`),
    ],
    expected: ['ok', 'ok', 'denied', 'denied', 'denied', 'denied'],
  });
});

test('startup refuses a schema-altering role', async () => {
  const runtime = await db.transaction(async (tx) => {
    await tx.execute(sql`set local role daisy_admin_app`);
    return schemaPowers(tx);
  });
  assert({
    given: 'the owner (a superuser locally) and daisy_admin_app',
    should: 'find schema powers only on the owner',
    actual: [(await schemaPowers(db)).includes('is a superuser'), runtime],
    expected: [true, []],
  });
});

test('the chain verifier', async () => {
  await append(4);
  const intact = await verifyStoredChain(db);
  const [head] = await readAuditPage(db, { limit: 1 });
  await db
    .update(auditEvents)
    .set({ outcome: 'edited' })
    .where(eq(auditEvents.seq, 2));
  const edited = await verifyStoredChain(db);
  await db
    .update(auditEvents)
    .set({ outcome: null })
    .where(eq(auditEvents.seq, 2));
  await db.delete(auditEvents).where(eq(auditEvents.seq, 4));
  const truncated = await verifyStoredChain(db, head ? [head] : []);
  const page = await readAuditPage(db, { limit: 2, before: 3 });
  assert({
    given:
      'an intact chain, an edited row and a tail truncated past a known head',
    should: 'report consistent, broken at the row, and truncated',
    actual: [intact, edited, truncated, page.map(({ seq }) => seq)],
    expected: [
      { status: 'consistent', first: 1, last: 4 },
      { status: 'broken', seq: 2, reason: 'hash' },
      { status: 'truncated', expectedSeq: 4 },
      [2, 1],
    ],
  });
  assert({
    given: 'the newest row',
    should: 'be read first',
    actual: (
      await db.select().from(auditEvents).orderBy(desc(auditEvents.seq))
    )[0]?.seq,
    expected: 3,
  });
});
