import { withRoomOutboxFailure } from './room-outbox-rollback.test-support';
import { assertRejects } from '@daisy/errors/testing';
import { withRoomRuntime } from './room-runtime.test-support';
import { assert, test, setupRitewayBun } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';

requireTestServices(process.env);
setupRitewayBun();

test('prep persists one anchor with its receipt and refuses concurrent assembly edits', async () => {
  await withRoomRuntime(async (f) => {
    let view = await f.assemble();
    const definition = {
      ...view.definition,
      configurable: {
        ...view.definition.configurable,
        preRoundPrep: { durationMs: { min: 0, max: 60_000 } },
        resolutionDraw: null,
      },
    };
    const config = {
      ...view.config,
      preRoundPrep: { enabled: true as const, durationMs: 60_000 },
      resolutionDraw: { enabled: false },
    };
    view = (
      await f.command(f.host, view, {
        type: 'update-format',
        definition,
        config,
      })
    ).view;
    await assertRejects({
      given: 'format edit reset readiness before prep',
      should: 'reject start before persisting its anchor',
      actual: () => f.command(f.host, view, { type: 'start-pre-round' }),
      code: 'CONFLICT',
    });
    view = (await f.consent(f.host, view, 'ready')).view;
    view = (await f.consent(f.guest, view, 'ready')).view;
    const beforeStart = await f.snapshot(view.id);
    await withRoomOutboxFailure(f.sql, view.id, async () => {
      let rolledBack = false;
      try {
        await f.command(f.host, view, { type: 'start-pre-round' });
      } catch {
        rolledBack = true;
      }
      assert({
        given: 'the prep transaction cannot append its doorbell',
        should: 'roll back the anchor, receipt and all assembly rows',
        actual: [rolledBack, await f.snapshot(view.id)],
        expected: [true, beforeStart],
      });
    });
    const started = await f.command(f.host, view, { type: 'start-pre-round' });
    const committed = started.view;
    const committedBefore = await f.snapshot(view.id);
    for (const who of [f.host, f.guest]) {
      for (const type of ['ready', 'unready'] as const)
        await assertRejects({
          given: 'a stale readiness intent after prep commitment',
          should: 'refuse without changing durable state',
          actual: () => f.consent(who, committed, type),
          code: 'CONFLICT',
        });
      await f.expire(committed, who.actorId);
    }
    const reread = await f.operations.view(f.host, view.id);
    assert({
      given: 'committed prep after both leases expire',
      should: 'retain effective readiness and immutable state',
      actual: [
        reread.readiness.readyActorIds.length,
        reread.capabilities.canReady,
        await f.snapshot(view.id),
      ],
      expected: [2, false, committedBefore],
    });
    const anchor = started.view.prep.startedAt;
    const [persisted] =
      await f.sql`select prep_started_at, version from rooms where id=${view.id}`;
    const before = await f.snapshot(view.id);
    await assertRejects({
      given: 'prep has just started with a full minute remaining',
      should: 'refuse early completion',
      actual: () => f.command(f.host, started.view, { type: 'finish-prep' }),
      code: 'CONFLICT',
    });
    const replay = await f.operations.command(f.host, view.id, {
      type: 'start-pre-round',
      commandId: started.receipt.commandId,
      expectedVersion: view.version,
    });
    assert({
      given: 'an accepted prep start, early finish and exact start retry',
      should:
        'persist one original anchor and leave receipts and outbox unchanged on refusal/replay',
      actual: [
        Boolean(anchor),
        new Date(persisted.prep_started_at).toISOString(),
        replay.view.prep.startedAt,
        await f.snapshot(view.id),
      ],
      expected: [true, anchor, anchor, before],
    });
    await assertRejects({
      given: 'prep is already anchored to the pinned assembly',
      should: 'refuse a config edit during prep',
      actual: () =>
        f.command(f.host, started.view, { type: 'update-config', config }),
      code: 'CONFLICT',
    });
    assert({
      given: 'a config mutation is refused during running prep',
      should: 'preserve the anchor, pinned configuration, receipts and outbox',
      actual: await f.snapshot(view.id),
      expected: before,
    });
  });
});

test('committed prep launches one shared Round after readiness leases expire', async () => {
  await withRoomRuntime(async (f) => {
    let view = await f.assemble();
    view = (
      await f.command(f.host, view, {
        type: 'update-format',
        definition: {
          ...view.definition,
          configurable: {
            ...view.definition.configurable,
            preRoundPrep: { durationMs: { min: 1, max: 1000 } },
            resolutionDraw: null,
          },
        },
        config: {
          ...view.config,
          preRoundPrep: { enabled: true, durationMs: 1 },
          resolutionDraw: { enabled: false },
        },
      })
    ).view;
    for (const who of [f.host, f.guest])
      view = (await f.consent(who, view, 'ready')).view;
    view = (await f.command(f.host, view, { type: 'start-pre-round' })).view;
    for (const who of [f.host, f.guest]) await f.expire(view, who.actorId);
    const launched = (await f.command(f.host, view, { type: 'start-round' }))
      .view;
    const guest = await f.operations.view(f.guest, view.id);
    assert({
      given: 'committed prep whose Redis leases expired',
      should: 'launch the same durable Round for both participants',
      actual: [Boolean(launched.roundRef), guest.roundRef],
      expected: [true, launched.roundRef],
    });
  });
});
