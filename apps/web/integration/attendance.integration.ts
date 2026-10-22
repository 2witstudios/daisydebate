import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import { withAttendanceRound } from './attendance.test-support';
setupRitewayBun();

test('actual attendance operation preserves first receipt before Round contention and deduplicates both identities', async () =>
  withAttendanceRound(async ({ f, attendance, roundId, segmentId }) => {
    const principal = { kind: 'human', actorId: f.host.actorId } as const;
    const envelope = { version: 1, commandId: createId(), segmentId } as const;
    const targets = await attendance.targets(principal, roundId);
    assert({
      given: 'actual shared clock speech opening',
      should: 'discover the scoped unrecorded speech',
      actual: targets.map((t) => t.segmentId),
      expected: [segmentId],
    });
    const holder = await f.sql.reserve();
    let pending: Promise<unknown> | undefined;
    try {
      await holder`begin`;
      const [backend] = await holder`select pg_backend_pid() as pid`;
      await holder`select id from rounds where id=${roundId} for update`;
      const receipt = attendance.checkIn(principal, roundId, envelope);
      pending = receipt;
      const state = await finishedOrBlockedBehind(receipt, f.sql, backend.pid, {
        now: performance.now,
        deadlineMs: 800,
      });
      const [marker] =
        await f.sql`select state,to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as stamp from round_check_in_attempts where command_id=${envelope.commandId}`;
      assert({
        given: 'actual check-in blocked behind Round holder',
        should: 'already have its durable first-PG receipt marker',
        actual: [state, marker?.state],
        expected: ['blocked', 'pending'],
      });
      await holder`commit`;
      const first = await receipt;
      const replay = await attendance.checkIn(principal, roundId, envelope);
      const alias = await attendance.checkIn(principal, roundId, {
        ...envelope,
        commandId: createId(),
      });
      const [facts] =
        await f.sql`select (select count(*)::int from round_check_ins where round_id=${roundId}) as facts,(select count(*)::int from round_commands where round_id=${roundId} and type='check_in') as aliases,(select count(*)::int from round_check_in_attempts where round_id=${roundId} and state='pending') as pending`;
      assert({
        given:
          'lock released, lost acknowledgement retry and fresh operation alias',
        should:
          'replay original microsecond receipt and close every marker without duplicating facts',
        actual: [
          first.receivedAt,
          replay.receivedAt,
          alias.receivedAt,
          alias.replayed,
          facts,
        ],
        expected: [
          marker.stamp,
          marker.stamp,
          marker.stamp,
          true,
          { facts: 1, aliases: 2, pending: 0 },
        ],
      });
      assert({
        given: 'own committed receipt',
        should: 'stop rediscovering that target',
        actual: await attendance.targets(principal, roundId),
        expected: [],
      });
      await f.sql`update users set deleted_at=statement_timestamp(),username=null where id=${f.host.userId}`;
      await assertRejects({
        given: 'same acknowledged command after canonical erasure',
        should: 'freshly reject instead of granting receipt authority',
        actual: () => attendance.checkIn(principal, roundId, envelope),
        code: 'AUTHORIZATION',
      });
    } finally {
      await holder`rollback`;
      holder.release();
      if (pending) await Promise.allSettled([pending]);
    }
  }));
