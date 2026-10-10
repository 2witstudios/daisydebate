import type { RoomView } from '@daisy/protocol';
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
      expectedConsentVersion: lost.participants.find(
        (p) => p.actorId === f.host.actorId,
      )!.consentVersion,
    });
    f.unavailable(false);
    const recovered = await f.operations.view(f.host, view.id);
    assert({
      given: 'Unready committed during Redis loss',
      should: 'remain withdrawn after reconnect',
      actual: [
        revoked.receipt.replayed,
        recovered.participants.find((p) => p.actorId === f.host.actorId)!.ready,
      ],
      expected: [false, 'not-ready'],
    });
  });
});

test('Start and Unready serialize on the same durable authority fence', async () => {
  await withRoomRuntime(async (f) => {
    const view = await f.assemble();
    const { entered, release } = consentBarrier(f);
    const start = f.command(f.host, view, { type: 'start-round' });
    await entered;
    const unready = f
      .command(f.guest, view, {
        type: 'unready',
        expectedConsentVersion: view.participants.find(
          (p) => p.actorId === f.guest.actorId,
        )!.consentVersion,
      })
      .then(
        () => null,
        (error) => error as Error,
      );
    release();
    const accepted = await start;
    await assertRejects({
      given: 'Start acquired the account/Room fence before Unready',
      should:
        'commit one Round and refuse subsequent Unready on the closed assembly',
      actual: async () => {
        const error = await unready;
        if (error) throw error;
      },
      code: 'CONFLICT',
    });
    assert({
      given: 'the serialized Start wins',
      should: 'expose exactly its scheduled Round reference',
      actual: accepted.view.roundRef?.status,
      expected: 'scheduled',
    });
  });
  await withRoomRuntime(async (f) => {
    const view = await f.assemble();
    const { entered, release } = consentBarrier(f);
    const unready = f.consent(f.guest, view, 'unready');
    await entered;
    const start = f.command(f.host, view, { type: 'start-round' }).then(
      () => null,
      (error) => error as Error,
    );
    release();
    const withdrawn = await unready;
    const before = await f.snapshot(view.id);
    await assertRejects({
      given: 'Unready acquired the fence while Start was concurrently pending',
      should: 'refuse Start without freezing a Round',
      actual: async () => {
        const error = await start;
        if (error) throw error;
      },
      code: 'CONFLICT',
    });
    assert({
      given: 'the serialized Unready wins',
      should: 'leave all state unchanged on refused Start',
      actual: [await f.snapshot(view.id), withdrawn.view.roundRef],
      expected: [before, null],
    });
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
