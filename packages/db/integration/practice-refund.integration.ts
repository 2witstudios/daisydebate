import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { eq } from 'drizzle-orm';
import { writeProjectionWithPhaseSignal } from '../src/round-projection-writer';
import { rounds } from '../src/schema/rounds';
import { refundUnservedPracticeLocked } from '../src/round-bot-admission';
import { withGeneration } from './bot-generation.test-support';
setupRitewayBun();
requireTestServices(process.env);

type Generation = Parameters<Parameters<typeof withGeneration>[0]>[0];

/** Abandons the Round through the shared terminal projection path. */
const abandon = ({ run, target }: Generation) =>
  run(async (tx) => {
    const [current] = await tx
      .select()
      .from(rounds)
      .where(eq(rounds.id, target.roundId))
      .for('update');
    const now = new Date().toISOString();
    await writeProjectionWithPhaseSignal(
      tx,
      target.roundId,
      current!,
      {
        round: {
          status: 'abandoned',
          currentStage: null,
          startedAt: current!.startedAt?.toISOString() ?? null,
          completedAt: now,
          outcome: null,
          checkpoint: current!.runtimeState as never,
        },
        segmentInserts: [],
        segmentCloses: [{ id: target.segmentId, endedAt: now }],
        effects: [],
      },
      now,
    );
  });

const refunded = async ({ fixture, reservation }: Generation) =>
  (
    await fixture.sql`select refunded_at from usage_reservations where id=${reservation.id}`
  )[0].refunded_at as Date | null;

test('an AI practice is refunded once when its Round ends without a served model call', async () => {
  const outcomes: Record<string, boolean> = {};
  for (const call of ['none', 'failed', 'unknown', 'received'] as const)
    await withGeneration(async (generation) => {
      const { target, operations } = generation;
      if (call !== 'none') {
        const claim = await operations.claimWorker(target);
        const begun = await operations.beginGeneration(
          claim.scope,
          claim.token,
          { kind: 'language' },
        );
        if (call !== 'unknown')
          await operations.finishGeneration(
            claim.scope,
            begun.execution,
            call,
            {
              inputTokens: call === 'received' ? 3 : 0,
              outputTokens: call === 'received' ? 2 : 0,
              characters: 0,
            },
          );
      }
      await abandon(generation);
      const first = await refunded(generation);
      outcomes[call] = first !== null;
      if (call === 'failed') {
        await abandon(generation);
        outcomes['failed once'] =
          (await refunded(generation))?.getTime() === first?.getTime();
      }
    });
  assert({
    given:
      'bot Rounds abandoned with no model call, one definitely failed call, one call in flight and one received call',
    should:
      'refund the practice whose only call definitely failed, once; keep the ones that may have been served; never refund an uncounted one, which stops spending at Round end instead (ISSUE-469)',
    actual: outcomes,
    expected: {
      none: false,
      failed: true,
      'failed once': true,
      unknown: false,
      received: false,
    },
  });
});

test('concurrent refund attempts after a Round ended refund the practice exactly once', async () => {
  await withGeneration(async (generation) => {
    const { run, target, operations } = generation;
    const claim = await operations.claimWorker(target);
    const begun = await operations.beginGeneration(claim.scope, claim.token, {
      kind: 'language',
    });
    await operations.finishGeneration(claim.scope, begun.execution, 'failed', {
      inputTokens: 0,
      outputTokens: 0,
      characters: 0,
    });
    await abandon(generation);
    const first = await refunded(generation);
    await Promise.all(
      [0, 1].map(() =>
        run((tx) => refundUnservedPracticeLocked(tx, target.roundId)),
      ),
    );
    const after = await refunded(generation);
    assert({
      given:
        'a practice refunded at Round end, then two concurrent refund attempts on any instance',
      should:
        'keep the one refund: refunded_at is never stamped again (ISSUE-457-r1)',
      actual: {
        refunded: first !== null,
        same: after?.getTime() === first?.getTime(),
      },
      expected: { refunded: true, same: true },
    });
  });
});
