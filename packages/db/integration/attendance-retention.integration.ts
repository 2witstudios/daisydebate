import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { availabilityOperations } from '../src/availability-operations';
import { commandRetention } from '../src/command-retention';
import { withFixture } from './constraint-helpers';
import { validRules } from './round-fixtures';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const before = '2026-10-22T00:00:00.000000Z';

test('bounded retention prunes old leases/samples and preserves durable attendance receipt fences', async () =>
  withFixture(databaseUrl, async (f) => {
    const roundId = await f.round({
      status: 'active',
      current_stage: 'live',
      started_at: new Date('2026-10-21T00:00:00Z'),
    });
    const seat = await f.seat(roundId, 'affirmative');
    const segmentId = createId();
    const rule = validRules.segments.find((rule) => rule.type === 'speech')!;
    await f.insert('round_segments', {
      id: segmentId,
      round_id: roundId,
      sequence: 0,
      type: 'speech',
      rules_segment_key: rule.key,
      started_at: new Date('2026-10-21T00:00:00Z'),
      duration_ms: rule.durationMs,
    });
    const protectedId = createId(),
      aliasId = createId(),
      pendingId = createId();
    for (const id of [protectedId, aliasId, pendingId])
      await f.insert(
        'round_commands',
        {
          command_id: id,
          round_id: roundId,
          actor_id: seat.actorId,
          type: 'check_in',
          payload_digest: 'a'.repeat(64),
          result: {},
          resulting_version: 1,
          applied_at: new Date('2026-10-21T00:00:01Z'),
        },
        'command_id',
      );
    await f.sql`insert into round_check_ins(command_id,round_id,segment_id,participant_id,received_at) values(${protectedId},${roundId},${segmentId},${seat.id},'2026-10-21T00:00:01Z')`;
    await f.sql`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,received_at,backend_pid,backend_started_at) select ${createId()},${pendingId},${roundId},${'a'.repeat(64)},${seat.actorId},'2026-10-21T00:00:01Z',pid,backend_start from pg_stat_activity where pid=pg_backend_pid()`;
    const oldLease = createId(),
      boundaryLease = createId();
    try {
      await f.sql`insert into service_instances(instance_id,role,renewed_at) values(${oldLease},'web',${before}::timestamptz-interval '1 microsecond'),(${boundaryLease},'web',${before}::timestamptz)`;
      await f.sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(59003)`;
        await tx`insert into availability_samples(at,healthy,cause) values(${before}::timestamptz-interval '1 microsecond',true,null),(${before}::timestamptz,true,null)`;
      });
      const ops = availabilityOperations(f.sql);
      const commands = commandRetention({
        database: drizzle({ client: f.sql }),
      });
      const deleted = await Promise.all([
        ops.purgeExpiredServiceInstances({ before, limit: 1 }),
        ops.purgeExpiredAvailabilitySamples({ before, limit: 1 }),
        commands.purgeExpiredRoundCommands({ before, limit: 10 }),
      ]);
      const left =
        await f.sql`select command_id from round_commands where round_id=${roundId} order by command_id`;
      const [pending] =
        await f.sql`select state from round_check_in_attempts where round_id=${roundId}`;
      assert({
        given:
          'old first receipt, disposable alias and unresolved attempt ledger plus retention boundary rows',
        should:
          'delete only disposable expired rows without cascading facts or uncertainty',
        actual: {
          deleted,
          commands: left.map((row) => row.command_id),
          pending: pending.state,
          samples: (await ops.readAvailabilitySamples(before)).map(
            (row) => row.at,
          ),
        },
        expected: {
          deleted: [1, 1, 1],
          commands: [protectedId, pendingId].sort(),
          pending: 'pending',
          samples: [before],
        },
      });
    } finally {
      await f.sql`delete from service_instances where instance_id in (${oldLease},${boundaryLease})`;
      await f.sql`delete from availability_samples where at between ${before}::timestamptz-interval '1 microsecond' and ${before}::timestamptz`;
      await f.sql`delete from rounds where id=${roundId}`;
    }
  }));
