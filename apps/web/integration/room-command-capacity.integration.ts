import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createReadinessHandler } from '../src/server/readiness';
import { createRecordingLogger } from '../src/server/test-loggers.test-support';
import {
  withRoomRuntime,
  consentBarrier,
  assembleUnready,
} from './room-runtime.test-support';
import { createDatabase } from '@daisy/db';
import { createId } from '@paralleldrive/cuid2';
import { assertRejects } from '@daisy/errors/testing';
const services = requireTestServices(process.env);
setupRitewayBun();
test('paused Room preparations fill only the competitive lane and leave readiness capacity', async () => {
  await withRoomRuntime(async (f) => {
    const view = await f.assemble();
    const before = await f.snapshot(view.id);
    let enteredCount = 0;
    const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
    const { promise: released, resolve: release } =
      Promise.withResolvers<void>();
    f.gateConsent(async () => {
      // The default 12-connection web pool reserves four competitive slots.
      if (++enteredCount === 4) enter();
      await released;
    });
    const commands = Array.from({ length: 10 }, () =>
      f.command(f.host, view, { type: 'start-round' }),
    );
    const settled = Promise.allSettled(commands);
    try {
      await entered;
      const [occupancy] =
        await f.sql`select count(*)::int transactions, count(*) filter (where wait_event_type='Lock')::int lock_waiters from pg_stat_activity where datname=current_database() and state='idle in transaction'`;
      assert({
        given: 'bounded preparations waiting on external consent',
        should:
          'occupy only the competitive lane without account waiters or durable writes',
        actual: {
          transactions: occupancy.transactions,
          lockWaiters: occupancy.lock_waiters,
          snapshot: await f.snapshot(view.id),
        },
        expected: { transactions: 4, lockWaiters: 0, snapshot: before },
      });
      const health = (
        await createReadinessHandler({
          database: f.store,
          redis: f.redis,
          isDraining: () => false,
          logger: createRecordingLogger().logger,
        })(new Request('http://localhost/api/health/ready'))
      ).status;
      assert({
        given:
          'ten requested Room commands with admitted preparations paused awaiting external consent before account/Room fencing',
        should: 'leave capacity for unrelated database health',
        actual: health,
        expected: 200,
      });
    } finally {
      f.gateConsent(null);
      release();
      await settled;
    }
  });
});

test('a Room command on a saturated competitive lane is refused within its wait and never runs later', async () => {
  await withRoomRuntime(
    async (f) => {
      const { view, current, before } = await assembleUnready(f);
      const { entered, release } = consentBarrier(f);
      // The minimum web pool gives the competitive lane its single slot.
      const holding = f
        .consent(f.guest, current, 'ready')
        .catch(() => undefined);
      await entered;
      try {
        await assertRejects({
          given: 'the only competitive slot held by a paused preparation',
          should: 'refuse another Room command once its lane wait expires',
          actual: () => f.command(f.host, current, { type: 'start-round' }),
          code: 'INFRASTRUCTURE',
        });
      } finally {
        release();
      }
      await holding;
      assert({
        given: 'the refused command after the held slot settles',
        should: 'never execute it later: no Round launch reaches durable state',
        actual: JSON.parse(await f.snapshot(view.id)).rounds,
        expected: JSON.parse(before).rounds,
      });
    },
    { maxConnections: 4 },
  );
});

test('Room command admission releases permits after repeated preparation refusals', async () => {
  await withRoomRuntime(
    async (f) => {
      const view = await f.assemble(),
        before = await f.snapshot(view.id);
      for (let attempt = 0; attempt < 6; attempt++)
        await assertRejects({
          given: 'an unauthorized actor requesting Launch',
          should: 'refuse without leaking the sole admission permit',
          actual: () => f.command(f.outsider, view, { type: 'start-round' }),
          code: 'AUTHORIZATION',
        });
      assert({
        given: 'repeated refused preparations',
        should: 'preserve every competitive row and receipt',
        actual: await f.snapshot(view.id),
        expected: before,
      });
      await f.consent(f.guest, view, 'unready');
    },
    { maxConnections: 4 },
  );
});

for (const failure of ['redis', 'disconnect'] as const)
  test(`Room command admission recovers after ${failure} failure`, async () => {
    await withRoomRuntime(
      async (f) => {
        const { view, current, before } = await assembleUnready(f);
        let rejected: boolean;
        if (failure === 'redis') {
          f.failAfterReady(true);
          rejected = true;
          for (let attempt = 0; attempt < 6; attempt++)
            rejected =
              (await f.consent(f.guest, current, 'ready').then(
                () => false,
                () => true,
              )) && rejected;
          f.failAfterReady(false);
        } else {
          const { promise: entered, resolve: enter } =
            Promise.withResolvers<void>();
          const { promise: released, resolve: release } =
            Promise.withResolvers<void>();
          f.gateConsent(async () => {
            enter();
            await released;
          });
          const pending = f.consent(f.guest, current, 'ready').then(
            () => false,
            () => true,
          );
          await entered;
          try {
            const [{ stopped }] =
              await f.sql`select count(*) filter(where pg_terminate_backend(pid))::int stopped from pg_stat_activity where datname=current_database() and state='idle in transaction' and query like '%statement_timestamp%'`;
            if (stopped !== 1)
              throw new Error(
                'Disconnect proof did not identify exactly its owned preparation',
              );
          } finally {
            f.gateConsent(null);
            release();
          }
          rejected = await pending;
        }
        assert({
          given: `${failure} before final atomic authorization`,
          should: 'reject and preserve every competitive row',
          actual: { rejected, snapshot: await f.snapshot(view.id) },
          expected: { rejected: true, snapshot: before },
        });
        const ready = await f.consent(f.guest, current, 'ready');
        const replay = await f.command(
          f.guest,
          current,
          {
            type: 'ready',
            expectedConsentVersion: current.participants.find(
              (p) => p.actorId === f.guest.actorId,
            )!.consentVersion,
          },
          ready.receipt.commandId,
        );
        assert({
          given: 'fresh work and an exact retry after the failed preparation',
          should: 'recover the permit and retain durable replay semantics',
          actual: [ready.receipt.replayed, replay.receipt.replayed],
          expected: [false, true],
        });
      },
      { maxConnections: 4 },
    );
  });

test('same-command retries retain readiness capacity and never repeat lease preparation', async () => {
  await withRoomRuntime(async (f) => {
    const assembled = await f.assemble();
    const view = (await f.consent(f.guest, assembled, 'unready')).view;
    const { entered, release } = consentBarrier(f, 'write');
    const body = {
      type: 'ready',
      expectedConsentVersion: view.participants.find(
        (p) => p.actorId === f.guest.actorId,
      )!.consentVersion,
    };
    const commandId = createId();
    // Within the four competitive slots, so no attempt waits on the lane queue.
    const attempts = Array.from({ length: 4 }, () =>
      f.command(f.guest, view, body, commandId),
    );
    const settled = Promise.allSettled(attempts);
    await entered;
    try {
      const response = await createReadinessHandler({
        database: f.store,
        redis: f.redis,
        isDraining: () => false,
        logger: createRecordingLogger().logger,
      })(new Request('http://localhost/api/health/ready'));
      assert({
        given:
          'same-command retries queued behind the original SQL advisory fence',
        should:
          'leave readiness capacity while preserving command serialization',
        actual: response.status,
        expected: 200,
      });
    } finally {
      release();
    }
    const results = await settled;
    const receipts = results.flatMap((r) =>
      r.status === 'fulfilled' ? [r.value.receipt.replayed] : [],
    );
    assert({
      given: 'four same-command retries inside the competitive lane',
      should: 'accept once and replay the rest behind the command fence',
      actual: {
        accepted: receipts.filter((r) => !r).length,
        replayed: receipts.filter(Boolean).length,
        refused: results
          .filter((r) => r.status === 'rejected')
          .map((r) => r.reason.code),
      },
      expected: { accepted: 1, replayed: 3, refused: [] },
    });
  });
});

test('a web pool smaller than its lanes is refused and the minimum pool serves Room work', async () => {
  await assertRejects({
    given: 'a one-connection web pool',
    should: 'refuse the configuration rather than leave lanes unable to run',
    actual: async () =>
      createDatabase({
        url: services.databaseUrl,
        nextActorId: createId,
        maxConnections: 1,
      }),
    code: 'VALIDATION',
  });
  await withRoomRuntime(
    async (f) => {
      const view = await f.assemble();
      assert({
        given: 'the minimum four-connection web pool',
        should: 'complete normal Room work with one slot per lane',
        actual: (await f.operations.view(f.host, view.id)).id,
        expected: view.id,
      });
    },
    { maxConnections: 4 },
  );
});
