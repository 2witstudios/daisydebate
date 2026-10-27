import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('a revoked participant never blocks the opponent finishing the Round (ADR 0075)', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble();
    const { roundId, operations, envelope } = await startRuntimeRound(f, room);
    // The operator revokes the host mid-Round, as the signed command commits it.
    await f.sql.begin(async (tx) => {
      await tx`update account_beta_access set state='revoked', revision=revision+1, decided_at=now() where user_id=${f.host.userId}`;
      await tx`update users set version=version+1 where id=${f.host.userId}`;
    });
    const started = await f.store.getRound(roundId);
    const seatOf = (actorId: string) =>
      started!.participants.find((p) => p.actorId === actorId)!;
    const seated = (
      type: 'yield' | 'forfeit',
      actorId: string,
      expectedVersion: number,
    ) =>
      operations.command({ kind: 'human', actorId }, roundId, {
        ...envelope,
        commandId: createId(),
        expectedVersion,
        command: { type, participantId: seatOf(actorId).id },
      });
    await assertRejects({
      given:
        'the revoked host yielding on their own seat, after the revoke committed',
      should:
        'refuse it inside the fence: participation needs access, whatever the edge saw',
      actual: () => seated('yield', f.host.actorId, 2),
      code: 'AUTHORIZATION',
    });
    const receipt = await seated('forfeit', f.guest.actorId, 2);
    const ended = await f.store.getRound(roundId);
    assert({
      given:
        'the opponent of a revoked participant ending the Round by forfeit',
      should:
        'accept the command and settle the Round, judging the revoked account by membership, not access',
      actual: {
        version: receipt.resultingVersion,
        status: ended?.status,
        outcome: ended?.outcome !== null,
      },
      expected: { version: 3, status: 'completed', outcome: true },
    });
  });
});
