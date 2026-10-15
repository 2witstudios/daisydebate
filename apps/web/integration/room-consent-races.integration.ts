import { isNamedSeat, type RoomView } from '@daisy/protocol';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';

import { withRoomRuntime, consentBarrier } from './room-runtime.test-support';
requireTestServices(process.env);
setupRitewayBun();

test('a Redis write followed by transaction failure cannot establish consent after reconnect', async () => {
  await withRoomRuntime(async (f) => {
    let view = await f.assemble();
    view = (await f.consent(f.guest, view, 'unready')).view;
    const before = await f.snapshot(view.id);
    const failed = await failedReplacementReady(f, view);
    const reconnected = await f.operations.view(f.host, view.id);
    assert({
      given: 'Redis accepted a lease but PostgreSQL did not commit its fence',
      should:
        'leave all durable state unchanged and ignore the orphan lease on reconnect',
      actual: [
        failed,
        reconnected.capabilities.canStart,
        await f.snapshot(view.id),
      ],
      expected: [true, false, before],
    });
    f.unavailable(true);
    const lost = await f.operations.view(f.host, view.id);
    assert({
      given: 'Redis loss',
      should: 'project unavailable separately from false consent',
      actual: [
        lost.readiness.available,
        lost.startRefusal,
        lost.participants.every((p) => p.ready === 'unavailable'),
      ],
      expected: [false, 'readiness-unavailable', true],
    });
    await assertRejects({
      given: 'Start while Redis is unavailable',
      should: 'refuse without accepting durable mutation',
      actual: () => f.command(f.host, lost, { type: 'start-round' }),
      code: 'INFRASTRUCTURE',
    });
    const revoked = await f.command(f.host, lost, {
      type: 'unready',
      expectedConsentVersion: lost.participants
        .filter(isNamedSeat)
        .find((p) => p.actorId === f.host.actorId)!.consentVersion,
    });
    f.unavailable(false);
    const recovered = await f.operations.view(f.host, view.id);
    assert({
      given: 'Unready committed during Redis loss',
      should: 'remain withdrawn after reconnect',
      actual: [
        revoked.receipt.replayed,
        recovered.participants
          .filter(isNamedSeat)
          .find((p) => p.actorId === f.host.actorId)!.ready,
      ],
      expected: [false, 'not-ready'],
    });
  });
});

test('Start and Unready serialize on the same durable authority fence', async () => {
  for (const winner of ['start', 'unready'] as const)
    await withRoomRuntime(async (f) => {
      const view = await f.assemble();
      const { entered, release } = consentBarrier(f);
      const start = () => f.command(f.host, view, { type: 'start-round' });
      const unready = () => f.consent(f.guest, view, 'unready');
      const pending = (winner === 'start' ? unready() : start()).then(
        () => null,
        (error) => error,
      );
      await entered;
      try {
        const accepted = await (winner === 'start' ? start() : unready());
        const before = await f.snapshot(view.id);
        release();
        await assertRejects({
          given: `${winner} commits while its competitor prepares consent`,
          should:
            'refuse the stale competitor under the final account/Room fence',
          actual: async () => {
            const error = await pending;
            if (error) throw error;
          },
          code: 'CONFLICT',
        });
        assert({
          given: `the serialized ${winner} wins`,
          should:
            'preserve its complete durable snapshot and scheduled Round decision',
          actual: [
            await f.snapshot(view.id),
            accepted.view.roundRef?.status ?? null,
          ],
          expected: [before, winner === 'start' ? 'scheduled' : null],
        });
      } finally {
        release();
        await pending;
      }
    });
});

test('a failed replacement Ready preserves the committed readiness and durable snapshot', async () => {
  await withRoomRuntime(async (f) => {
    const view = await f.assemble();
    const before = await f.snapshot(view.id);
    const failed = await failedReplacementReady(f, view);
    const current = await f.operations.view(f.host, view.id);
    assert({
      given:
        'a ready member whose replacement Redis lease is written but SQL rolls back',
      should: 'preserve the accepted lease and all durable rows',
      actual: [
        failed,
        current.readiness.readyActorIds,
        await f.snapshot(view.id),
      ],
      expected: [true, view.readiness.readyActorIds, before],
    });
  });
});

async function failedReplacementReady(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
  view: RoomView,
): Promise<boolean> {
  f.failAfterReady(true);
  try {
    await f.consent(f.guest, view, 'ready');
    return false;
  } catch {
    return true;
  } finally {
    f.failAfterReady(false);
  }
}
