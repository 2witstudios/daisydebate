import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { appendOutboxEvent } from '../src/outbox';
import { createTestOnlyOperations } from '../src/test-only-operations';
import { drizzle } from 'drizzle-orm/bun-sql';
import { eq } from 'drizzle-orm';
import { isAppError } from '@daisy/errors';
import { ballots } from '../src/schema/ballots';
import { debateCommands } from '../src/schema/debate-commands';
import { at, digest, snapshotFor, withFixture } from './constraint-helpers';

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
  const testOnly = createTestOnlyOperations({ client: fixture });
  try {
    await testOnly.createUser({ id: userId, username: `test-${userId}` });
    await fixture`insert into actors (id, kind, user_id) values (${actorId}, 'human', ${userId})`;
    await fixture`insert into formats (id, name, rules, ranked_eligible) values (${formatId}, 'Fixture', '{"version":1,"seats":{"affirmative":1,"negative":1,"judge":0},"clock":{"speechMs":1000,"prepMs":0}}'::jsonb, false)`;
    await database.createDebate({
      id,
      createdBy: actorId,
      resolution: 'jsonb storage proof',
      format: formatId,
      snapshot: snapshotFor(id, { format: formatId }),
      mode: 'casual',
      visibility: 'unlisted',
    });
    const [afterCreate] = await fixture`
      select jsonb_typeof(snapshot) as type, snapshot->>'phase' as phase
      from debates where id = ${id}
    `;
    await testOnly.saveSnapshot({
      id,
      expectedVersion: 1,
      snapshot: snapshotFor(id, { format: formatId, phase: 'active' }),
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
  const fixture = new SQL(url);
  const testOnly = createTestOnlyOperations({ client: fixture });
  const debateId = createId();
  const topic = `debate:${debateId}`;
  try {
    await testOnly.transaction((tx) =>
      appendOutboxEvent(tx, {
        topic,
        kind: 'debate.phase-changed',
        version: 1,
        payload: {
          entityVersion: 1,
          kind: 'debate.phase-changed',
          ids: [debateId],
        },
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
    await fixture`delete from outbox where topic = ${topic}`;
    await fixture.close();
  }
});

test('a non-object jsonb write fails with a typed VALIDATION error before any row is written (ISSUE-24)', async () => {
  const database = createDatabase({ url, nextActorId: createId });
  const fixture = new SQL(url);
  const id = createId();
  try {
    const outcomes = await Promise.all(
      ['a bare string', 7, [], { phase: 'waiting' }].map((snapshot) =>
        database
          .createDebate({
            id,
            resolution: 'jsonb shape proof',
            format: 'foundation',
            snapshot,
            mode: 'casual',
            visibility: 'unlisted',
          })
          .then(
            () => 'written',
            (error: unknown) => (isAppError(error) ? error.code : 'untyped'),
          ),
      ),
    );
    const [row] =
      await fixture`select count(*)::int as n from debates where id = ${id}`;
    assert({
      given:
        'a string, a number, an array and an off-shape object as a snapshot',
      should: 'refuse each with AppError VALIDATION and write nothing',
      actual: { outcomes, rows: row?.n },
      expected: {
        outcomes: ['VALIDATION', 'VALIDATION', 'VALIDATION', 'VALIDATION'],
        rows: 0,
      },
    });
  } finally {
    await database.close();
    await fixture.close();
  }
});

test('every jsonb column refuses a scalar written around the application (ISSUE-24)', async () => {
  await withFixture(url, async (fixture) => {
    const scalar = 'a bare string';
    const debateId = await fixture.debate();
    const judge = await fixture.participant(debateId, 'judge');
    const refusals = {
      snapshot: await fixture.rejectedBy('debates', {
        id: createId(),
        resolution: 'r',
        format_id: 'foundation',
        snapshot: scalar,
        mode: 'casual',
        phase: 'waiting',
        visibility: 'public',
      }),
      rules: await fixture.rejectedBy('formats', {
        id: `fmt-${createId()}`,
        name: 'scalar rules',
        rules: scalar,
        ranked_eligible: false,
      }),
      scores: await fixture.rejectedBy('ballots', {
        id: createId(),
        debate_id: debateId,
        judge_actor_id: judge,
        decision: 'draw',
        scores: scalar,
        reason: 'r',
        status: 'submitted',
        submitted_at: at,
      }),
      result: await fixture.rejectedBy(
        'debate_commands',
        {
          command_id: createId(),
          debate_id: debateId,
          service_id: 'svc',
          type: 'debate.transition',
          payload_digest: digest,
          result: scalar,
          resulting_version: 1,
          applied_at: at,
        },
        'command_id',
      ),
      payload: await fixture.rejectedBy(
        'outbox',
        { topic: `debate:${debateId}`, kind: 'k', version: 1, payload: scalar },
        'topic',
      ),
    };
    assert({
      given: 'a jsonb string bound to each jsonb column in raw SQL',
      should: "be refused by that column's _is_object CHECK",
      actual: refusals,
      expected: {
        snapshot: 'debates_snapshot_is_object',
        rules: 'formats_rules_is_object',
        scores: 'ballots_scores_is_object',
        result: 'debate_commands_result_is_object',
        payload: 'outbox_payload_is_object',
      },
    });
  });
});

test('ballots.scores and debate_commands.result round-trip as jsonb objects through jsonbColumn (ISSUE-24)', async () => {
  await withFixture(url, async (fixture) => {
    const database = drizzle({ client: fixture.sql });
    const debateId = await fixture.debate();
    const judge = await fixture.participant(debateId, 'judge');
    const ballotId = createId();
    const commandId = createId();
    fixture.track('ballots', ballotId);
    fixture.track('debate_commands', commandId);
    const scores = { affirmative: 28, negative: 27 };
    const result = { accepted: true, version: 2 };
    await database.insert(ballots).values({
      id: ballotId,
      debateId,
      judgeActorId: judge,
      decision: 'affirmative',
      scores,
      reason: 'clearer case',
      status: 'submitted',
      submittedAt: at,
    });
    await database.insert(debateCommands).values({
      commandId,
      debateId,
      serviceId: 'svc',
      type: 'debate.transition',
      payloadDigest: digest,
      result,
      resultingVersion: 2,
      appliedAt: at,
    });
    const [stored] = await fixture.sql`
      select
        (select jsonb_typeof(scores) from ballots where id = ${ballotId}) as scores_type,
        (select jsonb_typeof(result) from debate_commands where command_id = ${commandId}) as result_type
    `;
    const [readBack] = await database
      .select({ scores: ballots.scores })
      .from(ballots)
      .where(eq(ballots.id, ballotId));
    assert({
      given: 'a Drizzle write of each column that has no adapter writer yet',
      should: 'store a jsonb object and read the same object back',
      actual: { ...stored, scores: readBack?.scores },
      expected: { scores_type: 'object', result_type: 'object', scores },
    });
  });
});
