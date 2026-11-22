import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withFlags, flagCommand } from './flags.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('a Flags session exposes one fenced application and replay has no apply capability', async () => {
  await withFlags(async ({ fixture, store, key }) => {
    const input = flagCommand(key, 0);
    let lateApply: ((revision: number) => Promise<unknown>) | undefined;
    const first = await store.flagCommand(input, async (session) => {
      const loaded = await session.load();
      if (loaded.kind !== 'fresh') throw new Error('Fresh command expected');
      lateApply = loaded.apply;
      return loaded.apply(loaded.revision + 1);
    });
    await assertRejects({
      given: 'an apply function retained after its transaction committed',
      should: 'refuse without another write',
      actual: () => lateApply!(2),
      code: 'INVARIANT',
    });
    const replay = await store.flagCommand(input, async (session) => {
      const loaded = await session.load();
      if (loaded.kind !== 'replayed')
        throw new Error('Receipt replay expected');
      assert({
        given: 'a replayed command',
        should: 'offer no new apply capability',
        actual: 'apply' in loaded,
        expected: false,
      });
      return loaded.result;
    });
    const [counts] = await fixture.sql`select
      (select revision from release_flags where key=${key}) as revision,
      (select count(*)::int from flag_change_events where key=${key}) as audit,
      (select count(*)::int from operator_command_receipts where command_id=${input.commandId}) as receipts`;
    assert({
      given: 'one application and its receipt replay',
      should:
        'return one result and commit exactly one atomic revision/audit/receipt',
      actual: { first, replay, counts },
      expected: {
        first,
        replay: first,
        counts: { revision: 1, audit: 1, receipts: 1 },
      },
    });
  });
});
