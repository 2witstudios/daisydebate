import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import { withAttendanceRound } from './attendance.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('canonical Round contention keeps actual check-in admission visible to the availability sampler', async () =>
  withAttendanceRound(async ({ f, attendance, roundId, segmentId }) => {
    const web = createId(),
      realtime = createId(),
      stamps: string[] = [];
    const sampler = f.store.availabilitySampler();
    const holder = await f.sql.reserve();
    let pending: Promise<unknown> | undefined;
    try {
      const [cursor] =
        await f.sql`select txid::text as txid,seq::text as seq from outbox order by txid desc,seq desc limit 1`;
      await f.store.renewServiceInstance({ instanceId: web, role: 'web' });
      await f.store.renewServiceInstance({
        instanceId: realtime,
        role: 'realtime',
        deliveredThrough: { txid: cursor.txid, seq: BigInt(cursor.seq) },
      });
      const baseline = await sampler.sample({
        publicProbeHealthy: true,
        controlWorkersHealthy: true,
      });
      if (baseline) stamps.push(baseline.at);
      await holder`begin`;
      const [backend] = await holder`select pg_backend_pid() as pid`;
      await holder`select id from rounds where id=${roundId} for no key update`;
      const commandId = createId(),
        started = performance.now();
      pending = attendance.checkIn(
        { kind: 'human', actorId: f.host.actorId },
        roundId,
        { version: 1, commandId, segmentId },
      );
      const refused = assertRejects({
        given: 'an existing canonical Round writer exceeds the execution slice',
        should: 'refuse the actual check-in',
        actual: () => pending!,
        code: 'INFRASTRUCTURE',
      });
      const blocked = await finishedOrBlockedBehind(
        pending,
        f.sql,
        backend.pid,
        { now: performance.now, deadlineMs: 800 },
      );
      const [admitted] =
        await f.sql`select state from round_check_in_attempts where command_id=${commandId}`;
      const sample = await sampler.sample({
        publicProbeHealthy: true,
        controlWorkersHealthy: true,
      });
      if (sample) stamps.push(sample.at);
      assert({
        given:
          'healthy services and actual check-in waiting behind a pre-existing canonical writer',
        should: 'expose its durable marker and postpone healthy availability',
        actual: {
          baseline: baseline?.healthy,
          blocked,
          marker: admitted?.state,
          sample: sample && { healthy: sample.healthy, cause: sample.cause },
        },
        expected: {
          baseline: true,
          blocked: 'blocked',
          marker: 'pending',
          sample: { healthy: false, cause: 'check_in_pending' },
        },
      });
      await refused;
      const elapsed = performance.now() - started;
      const [marker] =
        await f.sql`select state,backend_pid,backend_started_at::text as incarnation from round_check_in_attempts where command_id=${commandId}`;
      const [facts] =
        await f.sql`select exists(select 1 from pg_stat_activity where pid=${marker.backend_pid} and backend_start::text=${marker.incarnation}) as writer_present,(select count(*)::int from round_commands where command_id=${commandId}) as ledger,(select count(*)::int from round_check_ins where command_id=${commandId}) as checkins`;
      const [alive] = await holder`select pg_backend_pid() as pid`;
      assert({
        given:
          'the actual bounded operation finishes while the competing writer remains',
        should:
          'confirm abort and exact backend absence within two seconds without a competitive write',
        actual: {
          bounded: elapsed <= 2000,
          state: marker.state,
          holder: alive.pid === backend.pid,
          ...facts,
        },
        expected: {
          bounded: true,
          state: 'aborted',
          holder: true,
          writer_present: false,
          ledger: 0,
          checkins: 0,
        },
      });
    } finally {
      await holder`rollback`;
      holder.release();
      if (pending) await Promise.allSettled([pending]);
      await sampler.close();
      for (const stamp of stamps)
        await f.sql`delete from availability_samples where at=${stamp}::timestamptz`;
      await f.sql`delete from service_instances where instance_id in (${web},${realtime})`;
    }
  }));
