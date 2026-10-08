import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import type { createDatabase } from '@daisy/db';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withSql } from './fixtures';
import { withPractice } from './ai-debate.test-support';

setupRitewayBun();
requireTestServices(process.env);

const appendAiQuestion = async (
  database: ReturnType<typeof createDatabase>,
  id: string,
) => {
  const round = (await database.getRound(id))!;
  const segment = round.segments.find((row) => row.sequence === 1)!;
  const bot = round.participants.find((seat) => seat.role === 'negative')!;
  const utteranceId = createId();
  await database.appendUtterance({
    id: utteranceId,
    roundId: id,
    segmentId: segment.id,
    roundParticipantId: bot.id,
    text: 'An AI question.',
    requireOpen: true,
  });
  return { round, segment, utteranceId };
};

for (const state of ['expired', 'completed'] as const) {
  test(`a durable ${state} AI line cannot buy voice or change its transcript`, async () => {
    await withPractice(
      async ({ actorId, id, operations, database, expireAt }) => {
        await expireAt(321);
        const view = await operations.view({ actorId, id });
        const { segment, utteranceId } = await appendAiQuestion(database, id);
        await operations.command({
          actorId,
          id,
          command: { type: 'yield' },
          expectedVersion: view.version,
        });
        if (state === 'completed') {
          const current = (await database.getRound(id))!;
          await operations.command({
            actorId,
            id,
            command: { type: 'abort' },
            expectedVersion: current.version,
          });
        } else {
          await withSql(async (sql) => {
            await sql`update round_segments set started_at = started_at - interval '31 seconds', ended_at = ended_at - interval '31 seconds' where id = ${segment.id}`;
          });
        }
        const before = await database.listRoundUtterances(id);
        const input = { actorId, id, utteranceId, phraseIndex: 0 };
        for (const operation of [
          () => operations.speak(input),
          () => operations.heard({ ...input, playedMs: 0, totalMs: 100 }),
        ])
          await assertRejects({
            given: `a ${state} segment’s persisted AI question`,
            should:
              'refuse playback and transcript edits before the provider or write',
            actual: operation,
            code: 'CONFLICT',
          });
        assert({
          given: 'the refused playback requests',
          should: 'retain the durable AI question',
          actual: await database.listRoundUtterances(id),
          expected: before,
        });
      },
    );
  });
}

test('a command between a persisted hydration tick and reread keeps its version authority', async () => {
  await withPractice(
    async ({ actorId, id, operations, database, expireAt }) => {
      await expireAt(11);
      const version = (await operations.view({ actorId, id })).version;
      const apply = database.applyRoundExecution;
      let race = true;
      let afterRival = await database.getRound(id);
      database.applyRoundExecution = async (input) => {
        await apply(input);
        if (race && input.command === null) {
          race = false;
          const { round } = await appendAiQuestion(database, id);
          await operations.command({
            actorId,
            id,
            command: { type: 'yield' },
            expectedVersion: round.version,
          });
          afterRival = await database.getRound(id);
        }
      };
      await withSql(async (sql) => {
        await sql`update rounds set started_at = started_at - interval '310 seconds' where id = ${id}`;
        await sql`update round_segments set started_at = started_at - interval '310 seconds' where round_id = ${id}`;
      });
      await assertRejects({
        given: 'a rival command after the hydration tick commits in PostgreSQL',
        should: 'reject the stale abort',
        actual: () =>
          operations.command({
            actorId,
            id,
            command: { type: 'abort' },
            expectedVersion: version,
          }),
        code: 'CONFLICT',
      });
      assert({
        given: 'the stale abort was refused',
        should: 'preserve the rival’s durable state',
        actual: await database.getRound(id),
        expected: afterRival,
      });
    },
  );
});
