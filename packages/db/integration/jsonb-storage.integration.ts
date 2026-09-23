import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { appendOutboxEvent } from '../src/outbox';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

/**
 * ISSUE-4: drizzle-orm 0.45.2's built-in `jsonb()` double-encodes every
 * write (`JSON.stringify` in `mapToDriverValue`, then Bun SQL serializes
 * the resulting string again), so `jsonb_typeof` reports `'string'` and
 * `->>` reads NULL. These assertions read the stored bytes directly with a
 * raw fixture connection, bypassing Drizzle's read path, which
 * `JSON.parse`s a double-encoded string back into an object and would hide
 * the bug (that is why `db.integration.ts`'s `snapshot` equality check
 * alone does not catch this).
 */
test('createDebate and saveSnapshot store snapshot as a real jsonb object, not a double-encoded string', async () => {
  const id = createId();
  const userId = createId();
  const actorId = createId();
  const formatId = `fmt-${createId()}`;
  const database = createDatabase({ url, nextActorId: createId });
  const fixture = new SQL(url);
  try {
    await database.createUser({ id: userId, username: `test-${userId}` });
    await fixture`insert into actors (id, kind, user_id) values (${actorId}, 'human', ${userId})`;
    await fixture`insert into formats (id, name, rules, ranked_eligible) values (${formatId}, 'Fixture', '{"version":1,"seats":{"affirmative":1,"negative":1,"judge":0},"clock":{"speechMs":1000,"prepMs":0}}'::jsonb, false)`;
    await database.createDebate({
      id,
      createdBy: actorId,
      resolution: 'jsonb storage proof',
      format: formatId,
      snapshot: { version: 1, id, phase: 'waiting' },
      mode: 'casual',
      visibility: 'unlisted',
    });
    const [afterCreate] = await fixture`
      select jsonb_typeof(snapshot) as type, snapshot->>'phase' as phase
      from debates where id = ${id}
    `;
    await database.saveSnapshot({
      id,
      expectedVersion: 1,
      snapshot: { version: 1, id, phase: 'active' },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const [afterSave] = await fixture`
      select jsonb_typeof(snapshot) as type, snapshot->>'phase' as phase
      from debates where id = ${id}
    `;
    assert({
      given: 'createDebate followed by saveSnapshot',
      should:
        'store snapshot as a jsonb object whose phase key is reachable with ->>, not a double-encoded string',
      actual: {
        afterCreate: { type: afterCreate?.type, phase: afterCreate?.phase },
        afterSave: { type: afterSave?.type, phase: afterSave?.phase },
      },
      expected: {
        afterCreate: { type: 'object', phase: 'waiting' },
        afterSave: { type: 'object', phase: 'active' },
      },
    });
  } finally {
    await database.close();
    try {
      await fixture`delete from debates where id = ${id}`;
      await fixture`delete from actors where id = ${actorId}`;
      await fixture`delete from users where id = ${userId}`;
      await fixture`delete from formats where id = ${formatId}`;
    } finally {
      await fixture.close();
    }
  }
});

test('appendOutboxEvent stores payload as a real jsonb object, not a double-encoded string', async () => {
  const database = createDatabase({ url, nextActorId: createId });
  const fixture = new SQL(url);
  const debateId = createId();
  const topic = `debate:${debateId}`;
  try {
    await database.transaction((tx) =>
      appendOutboxEvent(tx, {
        topic,
        kind: 'debate.phase-changed',
        version: 1,
        payload: { version: 1, kind: 'debate.phase-changed', ids: [debateId] },
      }),
    );
    const [row] = await fixture`
      select jsonb_typeof(payload) as type, payload->>'kind' as kind
      from outbox where topic = ${topic}
    `;
    assert({
      given: 'appendOutboxEvent',
      should: 'store payload as a jsonb object, not a double-encoded string',
      actual: { type: row?.type, kind: row?.kind },
      expected: { type: 'object', kind: 'debate.phase-changed' },
    });
  } finally {
    await database.close();
    await fixture`delete from outbox where topic = ${topic}`;
    await fixture.close();
  }
});
