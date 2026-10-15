import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { setup } from './operations.test-support';
setupRitewayBun();

const readyRound = async () => {
  const fixture = setup();
  const { store, begin, memory } = fixture;
  const id = await begin();
  const before = await store.getRound(id);
  if (!before) throw new Error('Round missing');
  return { ...fixture, id, before, commands: memory.commandsApplied() };
};

for (const roundBlock of [false, true])
  for (const receipt of [false, true]) {
    test(`fake no-op round block=${roundBlock}, command receipt=${receipt}`, async () => {
      const { store, memory, id, before, commands } = await readyRound();
      await store.applyRoundExecution({
        roundId: id,
        expectedVersion: before.version,
        command: receipt
          ? {
              commandId: 'no-op-command',
              actorId: null,
              serviceId: 'integration',
              type: 'interrupt',
              payloadDigest: 'a'.repeat(64),
              result: { ok: true },
            }
          : null,
        buildProjection: () => ({
          round: roundBlock
            ? {
                status: before.status,
                currentStage: before.currentStage,
                startedAt: before.startedAt,
                completedAt: before.completedAt,
                outcome: before.outcome,
                checkpoint: {
                  floor: before.checkpoint.floor,
                  active_prep: before.checkpoint.active_prep,
                  prep_consumed_ms: {
                    negative: before.checkpoint.prep_consumed_ms.negative,
                    affirmative: before.checkpoint.prep_consumed_ms.affirmative,
                  },
                  version: before.checkpoint.version,
                },
              }
            : null,
          segmentInserts: [],
          segmentCloses: [],
          effects: [],
        }),
      });
      assert({
        given: 'a projection without an observable state change',
        should:
          'preserve Round state and version while recording only an accepted command receipt',
        actual: [await store.getRound(id), memory.commandsApplied()],
        expected: [before, commands + Number(receipt)],
      });
    });
  }

test('a refused pure projection leaves the fake command ledger unchanged', async () => {
  const { store, memory, id, before, commands } = await readyRound();
  await assertRejects({
    given: 'a command whose pure projection refuses',
    should: 'propagate the refusal without a command receipt',
    actual: () =>
      store.applyRoundExecution({
        roundId: id,
        expectedVersion: before.version,
        command: {
          commandId: 'refused-command',
          actorId: null,
          serviceId: 'integration',
          type: 'interrupt',
          payloadDigest: 'a'.repeat(64),
          result: { ok: true },
        },
        buildProjection: () => {
          throw createAppError('CONFLICT');
        },
      }),
    code: 'CONFLICT',
  });
  assert({
    given: 'the refused command',
    should: 'leave both durable state and receipt ledger unchanged',
    actual: [await store.getRound(id), memory.commandsApplied()],
    expected: [before, commands],
  });
});
