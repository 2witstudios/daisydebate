import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import {
  availabilityOperations,
  type AvailabilityEvidence,
} from '../src/availability-operations';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

function remember(
  sample: AvailabilityEvidence | null,
  samples: string[],
): AvailabilityEvidence {
  if (!sample)
    throw new Error('The elected sampler must persist actual evidence');
  samples.push(sample.at);
  return sample;
}

test('sampler crash takeover and delayed actual outbox delivery remain observable', async () => {
  const client = new SQL(databaseUrl, { max: 5 });
  const ops = availabilityOperations(client);
  const first = ops.availabilitySampler(),
    second = ops.availabilitySampler();
  const web = createId(),
    realtime = createId(),
    topic = `availability:${createId()}`;
  const samples: string[] = [];
  const flags = { publicProbeHealthy: true };
  try {
    await ops.renewServiceInstance({ instanceId: web, role: 'web' });
    const [outbox] =
      await client`insert into outbox(topic,kind,version,payload,created_at) values(${topic},'phase',1,${{}},statement_timestamp()-interval '3 seconds') returning txid::text as txid,seq`;
    await ops.renewServiceInstance({
      instanceId: realtime,
      role: 'realtime',
      deliveredThrough: { txid: '0', seq: 0n },
    });
    assert({
      given: 'two actual reserved producer sessions',
      should: 'elect only one public-probe producer',
      actual: [await first.elect(), await second.elect()],
      expected: [true, false],
    });
    const lagged = remember(await first.sample(flags), samples);
    assert({
      given: 'fresh realtime lease whose cursor trails actual old outbox row',
      should: 'report delivery lag',
      actual: lagged.cause,
      expected: 'delivery_lag',
    });
    const [owner] =
      await client`select l.pid,a.backend_start::text as incarnation from pg_locks l join pg_stat_activity a on a.pid=l.pid where l.locktype='advisory' and l.classid=0 and l.objid=59003 and l.objsubid=1 and l.granted and a.datname=current_database()`;
    if (!owner) throw new Error('The actual sampler must own its session lock');
    const [terminated] =
      await client`select pg_terminate_backend(pid) as terminated from pg_stat_activity where pid=${owner.pid} and backend_start=${owner.incarnation}::timestamptz and datname=current_database()`;
    if (!terminated?.terminated)
      throw new Error('Owned sampler backend was not terminated');
    const deadline = performance.now() + 2000;
    while (
      (
        await client`select 1 from pg_locks where locktype='advisory' and pid=${owner.pid} and classid=0 and objid=59003 and granted`
      ).length
    ) {
      if (performance.now() > deadline)
        throw new Error('Owned sampler crash did not release election');
    }
    await ops.renewServiceInstance({
      instanceId: realtime,
      role: 'realtime',
      deliveredThrough: { txid: outbox.txid, seq: BigInt(outbox.seq) },
    });
    assert({
      given: 'the exact old sampler backend is confirmed absent',
      should: 'elect the healthy peer before its actual next public probe',
      actual: await second.elect(),
      expected: true,
    });
    const recovered = remember(await second.sample(flags), samples);
    assert({
      given: 'elected process crashes then actual delivery catches up',
      should: 'elect a different session and record a later healthy sample',
      actual: {
        healthy: recovered.healthy,
        later: recovered.at > lagged.at,
      },
      expected: { healthy: true, later: true },
    });
    await client`update service_instances set renewed_at=statement_timestamp()-interval '4 seconds' where instance_id=${realtime}`;
    const stale = remember(await second.sample(flags), samples);
    assert({
      given: 'whole realtime service has no fresh peer',
      should: 'report realtime outage instead of presence',
      actual: stale.cause,
      expected: 'realtime_stale',
    });
  } finally {
    await Promise.allSettled([first.close(), second.close()]);
    await client`delete from outbox where topic=${topic}`;
    await client`delete from service_instances where instance_id in (${web},${realtime})`;
    for (const at of samples)
      await client`delete from availability_samples where at=${at}::timestamptz`;
    await client.close();
  }
});

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
    const healthy = await first.sample({ publicProbeHealthy: true });
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
      actual: await second.sample({ publicProbeHealthy: true }),
      expected: null,
    });
    const broken = await first.sample({ publicProbeHealthy: false });
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
    const takeover = await second.sample({ publicProbeHealthy: false });
    if (takeover) sampled.push(takeover.at);
    assert({
      given: 'first elected session released while public probing still fails',
      should: 'take over without advertising healthy',
      actual: takeover && { healthy: takeover.healthy, cause: takeover.cause },
      expected: { healthy: false, cause: 'public_probe_failed' },
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
