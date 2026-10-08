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
import { roundCommands } from '../src/schema/round-commands';
import { at, roundAuthoring, digest, withFixture } from './constraint-helpers';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

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
test('createRound stores rules_snapshot as a real jsonb object, not a double-encoded string', () =>
  withFixture(url, async (fixture) => {
    const { roundId, rules, formatId, database } = await roundAuthoring(
      fixture,
      url,
    );
    try {
      await database.createRound({
        id: roundId,
        createdByActorId: null,
        resolution: 'jsonb storage proof',
        competitionType: 'casual',
        length: 'full',
        formatId,
        formatVersion: 1,
        presetVersion: null,
        rules,
      });
      const [afterCreate] = await fixture.sql`
      select jsonb_typeof(rules_snapshot) as type, rules_snapshot->>'version' as version
      from rounds where id = ${roundId}
    `;
      assert({
        given: 'createRound',
        should:
          'store rules_snapshot as a jsonb object whose version key is reachable with ->>, not a double-encoded string',
        actual: {
          afterCreate: {
            type: afterCreate?.type,
            version: afterCreate?.version,
          },
        },
        expected: {
          afterCreate: { type: 'object', version: '2' },
        },
      });
    } finally {
      await database.close();
    }
  }));

test('appendOutboxEvent stores payload as a real jsonb object, not a double-encoded string', async () => {
  const fixture = new SQL(url);
  const testOnly = createTestOnlyOperations({ client: fixture });
  const roundId = createId();
  const topic = `debate:${roundId}`;
  try {
    await testOnly.transaction((tx) =>
      appendOutboxEvent(tx, {
        topic,
        kind: 'debate.phase-changed',
        version: 1,
        payload: {
          entityVersion: 1,
          kind: 'debate.phase-changed',
          ids: [roundId],
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
      ['a bare string', 7, [], { version: 1 }].map((rules) =>
        database
          .createRound({
            id,
            createdByActorId: null,
            resolution: 'jsonb shape proof',
            competitionType: 'casual',
            length: 'full',
            formatId: 'foundation',
            formatVersion: 1,
            presetVersion: null,
            rules: rules as never,
          })
          .then(
            () => 'written',
            (error: unknown) => (isAppError(error) ? error.code : 'untyped'),
          ),
      ),
    );
    const [row] =
      await fixture`select count(*)::int as n from rounds where id = ${id}`;
    assert({
      given:
        'a string, a number, an array and an off-shape object as rules_snapshot',
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
    const roundId = await fixture.round();
    const judge = (await fixture.seat(roundId, 'judge')).id;
    const refusals = {
      rules_snapshot: await fixture.rejectedBy('rounds', {
        id: createId(),
        resolution: 'r',
        competition_type: 'casual',
        length: 'full',
        format_id: 'foundation',
        format_version: 1,
        rules_snapshot: scalar,
        status: 'scheduled',
      }),
      definition: await fixture.rejectedBy(
        'format_revisions',
        {
          format_id: `fmt-${createId()}`,
          version: 1,
          definition: scalar,
          created_at: at,
        },
        'format_id',
      ),
      scores: await fixture.rejectedBy('ballots', {
        id: createId(),
        judge_participant_id: judge,
        rubric_version: 'speaker-10@1',
        winner: 'affirmative',
        scores: scalar,
        reason: 'r',
        status: 'submitted',
        submitted_at: at,
      }),
      result: await fixture.rejectedBy(
        'round_commands',
        {
          command_id: createId(),
          round_id: roundId,
          service_id: 'svc',
          type: 'start',
          payload_digest: digest,
          result: scalar,
          resulting_version: 1,
          applied_at: at,
        },
        'command_id',
      ),
      payload: await fixture.rejectedBy(
        'outbox',
        { topic: `debate:${roundId}`, kind: 'k', version: 1, payload: scalar },
        'topic',
      ),
    };
    assert({
      given: 'a jsonb string bound to each jsonb column in raw SQL',
      should: "be refused by that column's _is_object CHECK",
      actual: refusals,
      expected: {
        rules_snapshot: 'rounds_rules_snapshot_is_object',
        definition: 'format_revisions_definition_is_object',
        scores: 'ballots_scores_is_object',
        result: 'round_commands_result_is_object',
        payload: 'outbox_payload_is_object',
      },
    });
  });
});

test('ballots.scores and round_commands.result round-trip as jsonb objects through jsonbColumn (ISSUE-24)', async () => {
  await withFixture(url, async (fixture) => {
    const database = drizzle({ client: fixture.sql });
    const roundId = await fixture.round();
    const judge = (await fixture.seat(roundId, 'judge')).id;
    const ballotId = createId();
    const commandId = createId();
    fixture.track('ballots', ballotId);
    fixture.track('round_commands', commandId);
    const categories = [
      'thesis',
      'framework',
      'analysis',
      'refutation',
      'impact',
      'weighing',
      'questioning',
      'answering',
      'organization',
      'delivery',
    ] as const;
    const sideScores = Object.fromEntries(
      categories.map((category) => [category, 3]),
    ) as Record<(typeof categories)[number], number>;
    const scores = { affirmative: sideScores, negative: { ...sideScores } };
    const result = { accepted: true, version: 2 };
    await database.insert(ballots).values({
      id: ballotId,
      judgeParticipantId: judge,
      rubricVersion: 'speaker-10@1',
      winner: 'affirmative',
      scores,
      reason: 'clearer case',
      status: 'submitted',
      submittedAt: at,
    });
    await database.insert(roundCommands).values({
      commandId,
      roundId,
      serviceId: 'svc',
      type: 'start',
      payloadDigest: digest,
      result,
      resultingVersion: 2,
      appliedAt: at,
    });
    const [stored] = await fixture.sql`
      select
        (select jsonb_typeof(scores) from ballots where id = ${ballotId}) as scores_type,
        (select jsonb_typeof(result) from round_commands where command_id = ${commandId}) as result_type
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
