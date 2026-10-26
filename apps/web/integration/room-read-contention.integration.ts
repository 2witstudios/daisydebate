import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { withRoomRuntime } from './room-runtime.test-support';
import { consentBarrier } from './room-consent-barrier.test-support';
requireTestServices(process.env);
setupRitewayBun();

for (const kind of ['read', 'write'] as const)
  test(`Room page reads complete while a command awaits consent ${kind}`, async () => {
    await withRoomRuntime(async (f) => {
      const view = await f.assemble();
      const { entered, release } = consentBarrier(f, kind);
      const pending =
        kind === 'read'
          ? f.command(f.host, view, { type: 'start-round' })
          : f.consent(f.guest, view, 'ready');
      await entered;
      try {
        await f.sql.begin(async (sql) => {
          await sql`select id from users where id in (${f.host.userId},${f.guest.userId}) for update nowait`;
          await sql`select id from rooms where id=${view.id} for update nowait`;
        });
        const reads = await Promise.allSettled([
          f.store.readRoomAssembly(
            view.id,
            f.host,
            (_state, account) => account?.member === true,
          ),
          f.store.listRoomCatalogSources(
            f.host,
            (account) => account?.member === true,
          ),
          f.store.listRoomBots(f.host, (account) => account?.member === true),
        ]);
        assert({
          given: `a command paused at Redis consent ${kind} with the three parallel hosted Room reads`,
          should:
            'release account/Room row locks and complete every read inside unchanged runtime bounds',
          actual: reads.map((read) => read.status),
          expected: ['fulfilled', 'fulfilled', 'fulfilled'],
        });
      } finally {
        release();
        await pending;
      }
    });
  });

for (const race of ['unready', 'cast', 'membership', 'erasure'] as const)
  test(`prepared Launch rechecks ${race} before committing`, async () => {
    await withRoomRuntime(async (f) => {
      const view = await f.assemble();
      const { entered, release } = consentBarrier(f);
      const pending = f.command(f.host, view, { type: 'start-round' }).then(
        () => null,
        (error) => error,
      );
      await entered;
      try {
        if (race === 'unready') await f.consent(f.guest, view, 'unready');
        if (race === 'cast')
          await f.command(f.guest, view, { type: 'leave-seat' });
        if (race === 'membership')
          await f.sql`update users set email_verified=false,version=version+1 where id=${f.host.userId}`;
        if (race === 'erasure')
          await f.sql`update users set username=null,email_verified=false,deleted_at=statement_timestamp(),version=version+1 where id=${f.guest.userId}`;
        const before = await f.snapshot(view.id);
        release();
        await assertRejects({
          given: `${race} committed while Launch was preparing Redis consent`,
          should: 'refuse stale consent or authority without freezing a Round',
          actual: async () => {
            const error = await pending;
            if (error) throw error;
          },
          code: race === 'membership' ? 'NOT_FOUND' : 'CONFLICT',
        });
        assert({
          given: 'the refused prepared Launch',
          should: 'leave all competitive rows, receipts and outbox unchanged',
          actual: await f.snapshot(view.id),
          expected: before,
        });
      } finally {
        release();
        await pending;
      }
    });
  });
