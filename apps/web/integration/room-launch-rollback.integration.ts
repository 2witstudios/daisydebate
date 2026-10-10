import { requireTestServices } from '@daisy/config';
import {
  roomViewSchema,
  roomCatalogChoiceSchema,
  roomCastChoiceSchema,
  roundViewSchema,
} from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';

import { withRoomOutboxFailure } from './room-outbox-rollback.test-support';
import { withRoomRuntime } from './room-runtime.test-support';
requireTestServices(process.env);
setupRitewayBun();

test('outbox failure rolls back Launch including frozen Round and participants', async () => {
  await withRoomRuntime(async (f) => {
    const view = await f.assemble(),
      before = await f.snapshot(view.id);
    await withRoomOutboxFailure(f.sql, view.id, async () => {
      let refused = false;
      try {
        await f.command(f.host, view, { type: 'start-round' });
      } catch {
        refused = true;
      }
      assert({
        given: 'outbox append fails after frozen Round insertion',
        should: 'roll back Room, commands, Round and cast completely',
        actual: [refused, await f.snapshot(view.id)],
        expected: [true, before],
      });
    });
    const launched = await f.command(f.host, view, { type: 'start-round' });
    roomViewSchema.parse(launched.view);
    (await f.operations.catalog(f.host)).forEach((choice) =>
      roomCatalogChoiceSchema.parse(choice),
    );
    (await f.operations.castChoices(f.host)).forEach((choice) =>
      roomCastChoiceSchema.parse(choice),
    );
    const read = await f.operations.roundView(
      f.guest,
      launched.view.roundRef!.id,
    );
    roundViewSchema.parse(read);
    assert({
      given: 'an untrusted incomplete Room or Round response',
      should: 'reject absent authoritative fields and unknown keys',
      actual: [
        roomViewSchema.safeParse({ id: view.id }).success,
        roundViewSchema.safeParse({ ...read, previewToken: 'fabricated' })
          .success,
      ],
      expected: [false, false],
    });
    assert({
      given: 'a clean retry after rollback',
      should:
        'read one persisted scheduled Round with frozen config and null clock',
      actual: [
        read.status,
        read.config,
        read.startedAt,
        read.participants.length,
      ],
      expected: ['scheduled', view.config, null, 2],
    });
  });
});
