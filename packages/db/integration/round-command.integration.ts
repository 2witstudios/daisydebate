import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createDatabase } from '../src';
import { withFixture } from './constraint-helpers';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('concurrent identical commands commit once and replay before stale-version refusal', async () => {
  await withFixture(url, async (fixture) => {
    const actorId = await fixture.actor();
    await fixture.sql.unsafe(
      'update users set email_verified = true where id = (select user_id from actors where id = $1)',
      [actorId],
    );
    const roundId = await fixture.round({ created_by_actor_id: actorId });
    const db = createDatabase({ url, nextActorId: createId });
    const commandId = createId();
    fixture.track('round_commands', commandId);
    const envelope = {
      version: 1 as const,
      commandId,
      expectedVersion: 1,
      command: { type: 'start' as const },
    };
    let executions = 0;
    const input = {
      roundId,
      envelope,
      principal: { kind: 'human' as const, actorId },
      payloadDigest: 'a'.repeat(64),
      authorize: () => undefined,
      buildProjection: ({
        round,
        now,
      }: {
        round: NonNullable<Awaited<ReturnType<typeof db.getRound>>>;
        now: string;
      }) => {
        executions += 1;
        return {
          round: {
            status: 'active' as const,
            currentStage: 'countdown' as const,
            startedAt: now,
            completedAt: null,
            outcome: null,
            checkpoint: round.checkpoint,
          },
          segmentInserts: [],
          segmentCloses: [],
          effects: [],
        };
      },
    };
    try {
      const results = await Promise.all([
        db.executeRoundCommand(input),
        db.executeRoundCommand(input),
      ]);
      assert({
        given: 'two concurrent identical commands at version 1',
        should: 'execute once and replay the original accepted version',
        actual: {
          executions,
          versions: results.map((r) => r.resultingVersion),
          replayed: results.map((r) => r.replayed).sort(),
        },
        expected: { executions: 1, versions: [2, 2], replayed: [false, true] },
      });
      assert({
        given: 'the committed command',
        should: 'write one audit row and one phase doorbell',
        actual: {
          commands: await fixture.count('round_commands', 'round_id', roundId),
          outbox: await fixture.count('outbox', 'topic', `debate:${roundId}`),
        },
        expected: { commands: 1, outbox: 1 },
      });
      await assertRejects({
        given: 'the same id with different payload',
        should: 'refuse rather than replay',
        actual: () =>
          db.executeRoundCommand({ ...input, payloadDigest: 'b'.repeat(64) }),
        code: 'CONFLICT',
      });
      await assertRejects({
        given: 'new id at stale version',
        should: 'refuse without calling pure execution',
        actual: () =>
          db.executeRoundCommand({
            ...input,
            envelope: { ...envelope, commandId: createId() },
          }),
        code: 'CONFLICT',
      });
      assert({
        given: 'both refusals',
        should: 'preserve the accepted projection',
        actual: { executions, version: (await db.getRound(roundId))?.version },
        expected: { executions: 1, version: 2 },
      });
      await fixture.sql.unsafe(
        'update users set username = $1 where id = (select user_id from actors where id = $2)',
        ['', actorId],
      );
      await assertRejects({
        given:
          'a canonical nonmember with an empty username retrying an accepted command',
        should: 'reauthorize and refuse replay',
        actual: () => db.executeRoundCommand(input),
        code: 'AUTHORIZATION',
      });
    } finally {
      await db.close();
    }
  });
});
