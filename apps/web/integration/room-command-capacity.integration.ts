import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createReadinessHandler } from '../src/server/readiness';
import { createRecordingLogger } from '../src/server/test-loggers.test-support';
import { withRoomRuntime, consentBarrier } from './room-runtime.test-support';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assertRejects } from '@daisy/errors/testing';
const services = requireTestServices(process.env);
setupRitewayBun();
test('Room command admission leaves default-pool readiness capacity during paused preparation', async () => {
  await withRoomRuntime(async (f) => {
    const view = await f.assemble();
    const before = await f.snapshot(view.id);
    let enteredCount = 0;
    const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
    const { promise: released, resolve: release } =
      Promise.withResolvers<void>();
    f.gateConsent(async () => {
      if (++enteredCount === 5) enter();
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
          'occupy half the default pool without account waiters or durable writes',
        actual: {
          transactions: occupancy.transactions,
          lockWaiters: occupancy.lock_waiters,
          snapshot: await f.snapshot(view.id),
        },
        expected: { transactions: 5, lockWaiters: 0, snapshot: before },
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

test('Room command reservation aborts while the actual pool is already occupied', async () => {
  const client = new SQL(services.databaseUrl, { max: 2 });
  await withRoomRuntime(
    async (f) => {
      const view = await f.assemble();
      const before = await f.snapshot(view.id);
      const held = [await client.reserve(), await client.reserve()];
      try {
        await assertRejects({
          given:
            'every physical SQL slot occupied before a Room command arrives',
          should:
            'reject bounded acquisition without later executing the queued mutation',
          actual: () => f.consent(f.guest, view, 'unready'),
          code: 'INFRASTRUCTURE',
        });
      } finally {
        for (const reserved of held) reserved.release();
      }
      await f.operations.view(f.host, view.id);
      assert({
        given: 'pool slots released after the acquisition deadline',
        should: 'discard the canceled waiter and preserve durable state',
        actual: await f.snapshot(view.id),
        expected: before,
      });
      const accepted = await f.consent(f.guest, view, 'unready');
      assert({
        given: 'fresh work after an aborted reservation',
        should: 'recover the admission permit',
        actual: accepted.receipt.replayed,
        expected: false,
      });
    },
    { client, maxConnections: 2 },
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
    { maxConnections: 2 },
  );
});

for (const failure of ['redis', 'disconnect'] as const)
  test(`Room command admission recovers after ${failure} failure`, async () => {
    await withRoomRuntime(
      async (f) => {
        const view = await f.assemble();
        const current = (await f.consent(f.guest, view, 'unready')).view;
        const before = await f.snapshot(view.id);
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
      { maxConnections: 2 },
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
    const attempts = Array.from({ length: 6 }, () =>
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
      given: 'six retries and a five-command default admission budget',
      should:
        'accept once, replay four times and refuse bounded excess before SQL',
      actual: {
        accepted: receipts.filter((r) => !r).length,
        replayed: receipts.filter(Boolean).length,
        refused: results
          .filter((r) => r.status === 'rejected')
          .map((r) => r.reason.code),
      },
      expected: { accepted: 1, replayed: 4, refused: ['INFRASTRUCTURE'] },
    });
  });
});

test('a deliberately single-slot Room adapter remains usable with bounded admission', async () => {
  await withRoomRuntime(
    async (f) => {
      const view = await f.assemble();
      assert({
        given: 'the configured one-slot pool',
        should:
          'complete normal serialized Room work without claiming spare physical capacity',
        actual: (await f.operations.view(f.host, view.id)).id,
        expected: view.id,
      });
    },
    { maxConnections: 1 },
  );
});
