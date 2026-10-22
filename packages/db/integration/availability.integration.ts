import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { availabilityOperations } from '../src/availability-operations';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('speech evidence retains incoming outage recovery, not just the preceding sample', async () => {
  const client = new SQL(databaseUrl, { max: 2 });
  try {
    await client.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(59003)`;
      await tx`insert into availability_samples(at,healthy,cause)
        select '2100-01-01T00:00:00Z'::timestamptz+n*interval '1 second',n>0,case when n=0 then 'public_probe_failed' else null end
        from generate_series(0,46) n order by n`;
    });
    const samples = await availabilityOperations(
      client,
    ).readAvailabilitySamples('2100-01-01T00:00:01.500Z');
    assert({
      given: 'outage then only one recovery sample before speech opens',
      should: 'include the unhealthy start and every recovery sample',
      actual: [samples[0]?.healthy, samples[0]?.at, samples.length],
      expected: [false, '2100-01-01T00:00:00.000000Z', 47],
    });
  } finally {
    await client`delete from availability_samples where at >= '2100-01-01T00:00:00Z'::timestamptz`;
    await client.close();
  }
});

test('PG-time leases and elected same-session sampler preserve real availability evidence', async () => {
  const client = new SQL(databaseUrl, { max: 6 });
  const ops = availabilityOperations(client);
  const first = ops.availabilitySampler();
  const second = ops.availabilitySampler();
  const sampled: string[] = [];
  const web = createId(),
    rt = createId(),
    stale = createId();
  try {
    await ops.renewServiceInstance({ instanceId: web, role: 'web' });
    await ops.renewServiceInstance({
      instanceId: rt,
      role: 'realtime',
      deliveredThrough: {
        txid: '18446744073709551615',
        seq: 9223372036854775807n,
      },
    });
    await client`insert into service_instances(instance_id,role,renewed_at) values(${stale},'web',statement_timestamp()-interval '4 seconds')`;
    const healthy = await first.sample({
      publicProbeHealthy: true,
      controlWorkersHealthy: true,
    });
    if (healthy) sampled.push(healthy.at);
    assert({
      given: 'fresh web/realtime peers and a dead web peer',
      should: 'sample healthy using actual PG leases and cursor',
      actual: healthy?.healthy,
      expected: true,
    });
    assert({
      given: 'a second sampler while first session holds election',
      should: 'refuse insertion',
      actual: await second.sample({
        publicProbeHealthy: true,
        controlWorkersHealthy: true,
      }),
      expected: null,
    });
    const broken = await first.sample({
      publicProbeHealthy: false,
      controlWorkersHealthy: true,
    });
    if (broken) sampled.push(broken.at);
    assert({
      given: 'public route failure despite fresh process leases',
      should: 'record unhealthy evidence with strictly later PG time',
      actual: broken &&
        healthy && {
          healthy: broken.healthy,
          cause: broken.cause,
          ordered: broken.at > healthy.at,
        },
      expected: { healthy: false, cause: 'public_probe_failed', ordered: true },
    });
    await first.close();
    const takeover = await second.sample({
      publicProbeHealthy: true,
      controlWorkersHealthy: false,
    });
    if (takeover) sampled.push(takeover.at);
    assert({
      given: 'first elected session released and unknown bot control health',
      should: 'take over without advertising healthy',
      actual: takeover && { healthy: takeover.healthy, cause: takeover.cause },
      expected: { healthy: false, cause: 'control_worker_unknown' },
    });
  } finally {
    await first.close();
    await second.close();
    await client`delete from service_instances where instance_id in (${web},${rt},${stale})`;
    for (const at of sampled)
      await client`delete from availability_samples where at=${at}::timestamptz`;
    await client.close();
  }
});

test('realtime role has the service lease write exception and no competitive or sample write', async () => {
  const client = new SQL(databaseUrl);
  const id = createId();
  try {
    const accepted = await client.begin(async (tx) => {
      await tx`set local role daisy_realtime`;
      await tx`insert into service_instances(instance_id,role,renewed_at,delivered_through,delivered_through_txid) values(${id},'realtime',statement_timestamp(),0,'0'::xid8)`;
      return (
        await tx`update service_instances set renewed_at=statement_timestamp() where instance_id=${id} returning instance_id`
      ).length;
    });
    assert({
      given: 'actual daisy_realtime DB role',
      should: 'insert and renew service lease',
      actual: accepted,
      expected: 1,
    });
    for (const table of [
      'availability_samples',
      'rounds',
      'round_commands',
      'round_check_ins',
      'round_attendance_adjudications',
    ]) {
      let code: string | undefined;
      try {
        await client.begin(async (tx) => {
          await tx`set local role daisy_realtime`;
          await tx.unsafe(`delete from ${table} where false`);
        });
      } catch (error) {
        code = (error as { errno?: string }).errno;
      }
      assert({
        given: `realtime write to ${table}`,
        should: 'refuse at PostgreSQL privilege boundary',
        actual: code,
        expected: '42501',
      });
    }
  } finally {
    await client`delete from service_instances where instance_id=${id}`;
    await client.close();
  }
});
