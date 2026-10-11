import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withRoomRuntime } from './room-runtime.test-support';
requireTestServices(process.env);
setupRitewayBun();
test('Room readers share account authority while an assembly awaits seat hydration', async () => {
  await withRoomRuntime(async (f) => {
    const view = await f.assemble();
    const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
    const { promise: released, resolve: release } =
      Promise.withResolvers<void>();
    const blocker = f.sql.begin(async (tx) => {
      await tx`lock table room_participants in access exclusive mode`;
      enter();
      await released;
    });
    await entered;
    const assembly = f.store.readRoomAssembly(
      view.id,
      f.host,
      (_state, account) => account?.member === true,
    );
    const assemblyResult = Promise.allSettled([assembly]);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 1000; attempt++) {
        const [row] =
          await f.sql`select exists(select 1 from pg_locks where relation='room_participants'::regclass and granted=false) waiting`;
        if (row.waiting) {
          waiting = true;
          break;
        }
      }
      if (!waiting)
        throw new Error(
          'Hydration did not reach observed SQL relation barrier',
        );
      const results = await Promise.allSettled(
        [f.host, f.guest].map((caller) =>
          f.store.listRoomBots(caller, (account) => account?.member === true),
        ),
      );
      assert({
        given:
          'one Room assembly blocked at real seat hydration while holding its caller fence',
        should:
          'allow unrelated bot reads for either caller inside existing runtime bounds',
        actual: results.map((r) => r.status),
        expected: ['fulfilled', 'fulfilled'],
      });
    } finally {
      release();
      await blocker;
      await assemblyResult;
    }
  });
});
