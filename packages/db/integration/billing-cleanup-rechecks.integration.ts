import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src/index';
import { withFixture } from './constraint-helpers';
const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();
const key = (prefix: string, n: number) =>
  prefix.repeat(20) + n.toString(36).padStart(4, '0');

test('runtime ACK discovery freezes an indexed upper key and ends a deleted-boundary pass before newer tail rows', async () =>
  withFixture(databaseUrl, async (fixture) => {
    const ids: string[] = [],
      pool = new SQL(databaseUrl, { max: 4 }),
      instanceId = createId();
    const roles = new Set<string>();
    const reserve = pool.reserve.bind(pool);
    pool.reserve = async (options) => {
      const connection = await reserve(options);
      await connection`set role daisy_web`;
      const [row] = await connection`select current_user as role`;
      roles.add(row!.role);
      return connection;
    };
    const database = createDatabase({
      url: databaseUrl,
      client: pool,
      nextActorId: createId,
    });
    const store = database.billingCleanup(instanceId);
    async function add(prefix: string) {
      for (let i = 1; i <= 33; i++) {
        const id = key(prefix, i),
          userId = await fixture.user();
        await fixture.sql`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp()) as at) insert into privacy_jobs(id,subject_ref,vendor,created_at,retry_at) select ${id},${userId},'posthog',at,at from sampled`;
        ids.push(id);
      }
    }
    try {
      await add('y');
      const [baseline] =
        await fixture.sql`select count(*)::int as n,max(id) as upper from privacy_jobs`;
      if (baseline!.upper !== key('y', 33))
        throw Error(
          'Fixture cannot own the maximum; no foreign row will be deleted',
        );
      await database.renewServiceInstance({ instanceId, role: 'web' });
      const first = await store.rechecks();
      if (!first.next) throw Error('Missing bounded continuation');
      await fixture.sql`delete from privacy_jobs where id=${key('y', 33)}`;
      await add('z');
      let pass = first.next,
        exhausted = false,
        requests = 0;
      const boundaries: string[] = [];
      for (let i = 0; i < Math.ceil(baseline!.n / 32) + 1; i++) {
        await database.renewServiceInstance({ instanceId, role: 'web' });
        const page = await store.rechecks(pass);
        requests++;
        boundaries.push(pass.throughId);
        if (!page.next) {
          exhausted = true;
          break;
        }
        if (page.next.afterId >= key('z', 1))
          throw Error('New tail leaked into captured pass');
        pass = page.next;
      }
      const fresh = await store.rechecks();
      assert({
        given:
          '33 owned generic jobs plus any prior test rows, a deleted captured maximum and33 higher inserted jobs',
        should:
          'end the fixed range under daisy_web and capture the new maximum only at the next head',
        actual: [
          first.next.throughId,
          exhausted,
          requests <= Math.ceil(baseline!.n / 32) + 1,
          boundaries.every((id) => id === key('y', 33)),
          fresh.next?.throughId,
          [...roles],
        ],
        expected: [key('y', 33), true, true, true, key('z', 33), ['daisy_web']],
      });
      for (const id of ids)
        await fixture.sql`delete from privacy_jobs where id=${id}`;
      const empty = await store.rechecks({
        afterId: key('z', 32),
        throughId: key('z', 33),
      });
      assert({
        given:
          'the last captured member and every owned tail member have been deleted',
        should: 'return exact empty exhaustion without chasing a newer range',
        actual: empty,
        expected: { rows: [], next: null },
      });
    } finally {
      for (const id of ids)
        await fixture.sql`delete from privacy_jobs where id=${id}`;
      await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
      await pool.close({ timeout: 0 });
    }
  }));
