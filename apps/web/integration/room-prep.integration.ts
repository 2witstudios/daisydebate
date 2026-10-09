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
      },
    };
    const config = {
      ...view.config,
      preRoundPrep: { enabled: true as const, durationMs: 60_000 },
    };
    view = (
      await f.command(f.host, view, {
        type: 'update-format',
        definition,
        config,
      })
    ).view;
    const started = await f.command(f.host, view, { type: 'start-prep' });
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
      type: 'start-prep',
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
