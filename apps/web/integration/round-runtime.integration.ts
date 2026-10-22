import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { withRoomRuntime } from './room-runtime.test-support';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';
setupRitewayBun();
requireTestServices(process.env);

test('shared human commands run the engine with atomic refusals and recover lost responses', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble();
    const launched = await f.command(f.host, room, { type: 'start-round' });
    const roundId = launched.view.roundRef!.id;
    const operations = createRoundRuntimeOperations({
      store: f.store,
      nextSegmentId: createId,
    });
    const commandId = createId();
    const envelope = {
      version: 1 as const,
      commandId,
      expectedVersion: 1,
      command: { type: 'start' as const },
    };
    const principal = { kind: 'human' as const, actorId: f.host.actorId };
    const receipt = await operations.command(principal, roundId, envelope);
    const round = await f.store.getRound(roundId);
    assert({
      given: 'the host starts a launched Round',
      should: 'persist the shared engine start from database time',
      actual: {
        version: receipt.resultingVersion,
        status: round?.status,
        started: round?.startedAt !== null,
      },
      expected: { version: 2, status: 'active', started: true },
    });
    const replay = await operations.command(principal, roundId, envelope);
    assert({
      given: 'a lost HTTP response followed by an identical retry',
      should: 'recover the original receipt',
      actual: replay,
      expected: { ...receipt, replayed: true },
    });
    const before = JSON.stringify(await f.store.getRound(roundId));
    const seat = round!.participants.find((p) => p.actorId === f.host.actorId)!;
    await assertRejects({
      given: 'an outsider naming the host seat',
      should: 'refuse the principal mismatch',
      actual: () =>
        operations.command(
          { kind: 'human', actorId: f.outsider.actorId },
          roundId,
          {
            ...envelope,
            commandId: createId(),
            expectedVersion: 2,
            command: { type: 'forfeit', participantId: seat.id },
          },
        ),
      code: 'AUTHORIZATION',
    });
    await assertRejects({
      given: 'a yield without a live segment',
      should: 'refuse engine illegality atomically',
      actual: () =>
        operations.command(principal, roundId, {
          ...envelope,
          commandId: createId(),
          expectedVersion: 2,
          command: { type: 'yield', participantId: seat.id },
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'authority and engine refusals',
      should: 'leave durable runtime and segment rows unchanged',
      actual: JSON.stringify(await f.store.getRound(roundId)),
      expected: before,
    });
  });
});
