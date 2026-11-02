import { withRoomOutboxFailure } from './room-outbox-rollback.test-support';
import { assertRejects } from '@daisy/errors/testing';
import { withRoomRuntime } from './room-runtime.test-support';
import { assert, test, setupRitewayBun } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { isNamedSeat } from '@daisy/protocol';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';

requireTestServices(process.env);
setupRitewayBun();

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

const withPrep = async (f: Fixture, durationMs = 60_000) => {
  const view = await f.assemble();
  return (
    await f.command(f.host, view, {
      type: 'update-format',
      definition: {
        ...view.definition,
        configurable: {
          ...view.definition.configurable,
          preRoundPrep: { durationMs: { min: 1, max: 60_000 } },
          resolutionDraw: null,
        },
      },
      config: {
        ...view.config,
        preRoundPrep: { enabled: true as const, durationMs },
        resolutionDraw: { enabled: false },
      },
    })
  ).view;
};

test('Start round commits readiness and prep in one transaction', async () => {
  await withRoomRuntime(async (f) => {
    let view = await withPrep(f);
    await assertRejects({
      given: 'a format edit that reset readiness',
      should: 'refuse Start round before creating a Round',
      actual: () => f.command(f.host, view, { type: 'start-round' }),
      code: 'CONFLICT',
    });
    view = (await f.consent(f.host, view, 'ready')).view;
    view = (await f.consent(f.guest, view, 'ready')).view;
    const beforeStart = await f.snapshot(view.id);
    await withRoomOutboxFailure(f.sql, view.id, async () => {
      let rolledBack = false;
      try {
        await f.command(f.host, view, { type: 'start-round' });
      } catch {
        rolledBack = true;
      }
      assert({
        given: 'the Start round transaction cannot append its doorbell',
        should: 'roll back the Round, receipt and all assembly rows',
        actual: [rolledBack, await f.snapshot(view.id)],
        expected: [true, beforeStart],
      });
    });
    const started = await f.command(f.host, view, { type: 'start-round' });
    const committed = started.view;
    const roundId = committed.roundRef!.id;
    const before = await f.snapshot(view.id);
    for (const who of [f.host, f.guest]) {
      for (const type of ['ready', 'unready'] as const)
        await assertRejects({
          given: 'a stale readiness intent after Start round',
          should: 'refuse without changing durable state',
          actual: () => f.consent(who, committed, type),
          code: 'CONFLICT',
        });
      await f.expire(committed, who.actorId);
    }
    await assertRejects({
      given: 'the host closing the Room during prep',
      should: 'refuse: the Round already exists',
      actual: () => f.command(f.host, committed, { type: 'close' }),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'a config edit during prep',
      should: 'refuse it',
      actual: () =>
        f.command(f.host, committed, {
          type: 'update-config',
          config: committed.config as never,
        }),
      code: 'CONFLICT',
    });
    const replay = await f.operations.command(f.host, view.id, {
      type: 'start-round',
      commandId: started.receipt.commandId,
      expectedVersion: view.version,
    });
    const round = await f.operations.roundView(f.guest, roundId);
    assert({
      given: 'Start round, refused writes, expired leases and an exact retry',
      should:
        'keep one Round in prep for both, with the Room, receipts and outbox unchanged',
      actual: [
        replay.view.roundRef,
        round.status,
        round.opening?.step.step,
        await f.snapshot(view.id),
      ],
      expected: [committed.roundRef, 'opening', 'prep', before],
    });
  });
});

test('a forfeit during prep stands as a result and frees the Room', async () => {
  await withRoomRuntime(async (f) => {
    let view = await withPrep(f);
    for (const who of [f.host, f.guest])
      view = (await f.consent(who, view, 'ready')).view;
    const roundId = (await f.command(f.host, view, { type: 'start-round' })).view
      .roundRef!.id;
    const round = await f.operations.roundView(f.guest, roundId);
    const seat = round.participants
      .filter(isNamedSeat)
      .find((p) => p.actorId === f.guest.actorId)!;
    await createRoundRuntimeOperations({
      store: f.store,
      nextSegmentId: createId,
    }).command({ kind: 'human', actorId: f.guest.actorId }, roundId, {
      version: 1,
      commandId: createId(),
      expectedVersion: round.version,
      command: { type: 'forfeit', participantId: seat.id },
    });
    const [row] = await f.sql`select status, outcome,
      (select count(*)::int from room_active_memberships m where m.room_id = ${view.id}) members
      from rounds where id = ${roundId}`;
    assert({
      given: 'the Negative forfeiting during prep',
      should: 'complete the Round for the Affirmative and release the members',
      actual: [row.status, row.outcome, row.members],
      expected: ['completed', 'affirmative', 0],
    });
  });
});
