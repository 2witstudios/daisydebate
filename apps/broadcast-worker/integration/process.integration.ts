import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEncodingWorker } from './encoding-worker.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test(
  'SIGTERM drains the actual broadcast process during an active encode',
  () =>
    withEncodingWorker(
      databaseUrl,
      async ({ sql, broadcastId, worker, writes, encoderAlive }) => {
        const before = [...writes];
        const started = performance.now();
        worker.kill('SIGTERM');
        const drained = await Promise.race([
          worker.exited.then((code) => ({ code })),
          Bun.sleep(8000).then(() => null),
        ]);
        assert({
          given:
            'SIGTERM after the actual process has claimed and spawned a stalled encoder',
          should:
            'exit successfully well within Fly’s 30s grace, reap the encoder and publish nothing further',
          actual: {
            drained,
            withinGrace: performance.now() - started < 30_000,
            encoderAlive: encoderAlive(),
            writes,
            before,
          },
          expected: {
            drained: { code: 0 },
            withinGrace: true,
            encoderAlive: false,
            writes: before,
            before,
          },
        });
        const [row] =
          await sql`select next_segment, hold_cursor from broadcasts where id=${broadcastId}`;
        assert({
          given: 'a cancelled encoding attempt',
          should: 'leave the durable cursor unchanged for the next owner',
          actual: { ...row },
          expected: { next_segment: 0, hold_cursor: 0 },
        });
      },
    ),
  30_000,
);

test(
  'a lease taken by another owner stops the encode before any further public write',
  () =>
    withEncodingWorker(
      databaseUrl,
      async ({
        sql,
        broadcastId,
        worker,
        writes,
        encoderAlive,
        releaseEncoder,
      }) => {
        const before = [...writes];
        // Another owner fences this one: its next renewal finds the lease gone.
        await sql`update broadcasts set lease_owner='another-owner', lease_epoch=lease_epoch+1 where id=${broadcastId}`;
        let reaped = false;
        for (let wait = 0; wait < 120 && !reaped; wait += 1) {
          reaped = !encoderAlive();
          if (!reaped) await Bun.sleep(100);
        }
        // Were the encode to finish now, its output must still never be published.
        releaseEncoder();
        await Bun.sleep(1_000);
        const exitedEarly = await Promise.race([
          worker.exited.then(() => true),
          Bun.sleep(0).then(() => false),
        ]);
        const [row] =
          await sql`select next_segment, hold_cursor, lease_owner from broadcasts where id=${broadcastId}`;
        assert({
          given:
            'the lease moved to another owner while the actual process encodes',
          should:
            'reap the encoder within a renewal, publish nothing further, leave the cursor and the new owner alone, and keep the process serving',
          actual: { reaped, writes, row: { ...row }, exitedEarly },
          expected: {
            reaped: true,
            writes: before,
            row: {
              next_segment: 0,
              hold_cursor: 0,
              lease_owner: 'another-owner',
            },
            exitedEarly: false,
          },
        });
      },
    ),
  30_000,
);
