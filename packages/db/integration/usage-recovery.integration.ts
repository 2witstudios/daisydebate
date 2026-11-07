import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { canReleaseFreeJudgeBinding } from '@daisy/auth/authorization';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src/index';
import { lockAuthorizationActors } from '../src/authorization';
import { finishedOrBlockedBehind } from '../src/testing';
import { withFreeBundle, withHeldCommit } from './usage-ledger.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('production usage recovery rediscovers abandoned bundles with current service authority and terminal replay identities', async () => {
  await withFreeBundle(
    async ({ f, actorId, roundId, replacement, admission }) => {
      const store = createDatabase({
        url: databaseUrl,
        client: f.sql,
        nextActorId: createId,
      });
      const instanceId = createId();
      const page = () =>
        store.readAbandonedUsageCandidates({ instanceId, limit: 25 });
      const release = () =>
        store.releaseAbandonedUsage(
          { instanceId, actorId, roundId },
          canReleaseFreeJudgeBinding,
        );
      try {
        await assertRejects({
          given: 'an unregistered service',
          should: 'refuse private usage discovery',
          code: 'AUTHORIZATION',
          actual: page,
        });
        await store.renewServiceInstance({ instanceId, role: 'web' });
        assert({
          given: 'a still-open admitted Round',
          should: 'never discover it for abandonment release',
          actual: (await page()).candidates,
          expected: [],
        });
        await f.sql`update rounds set status='abandoned',completed_at=clock_timestamp() where id=${roundId}`;
        const pending = await page();
        await f.sql`update service_instances set renewed_at=clock_timestamp()-interval '4 seconds' where instance_id=${instanceId}`;
        await assertRejects({
          given:
            'a service whose earlier discovery succeeded but authority expired',
          should: 'refuse release without touching the bundle',
          code: 'AUTHORIZATION',
          actual: release,
        });
        const [unchanged] =
          await f.sql`select count(*)::int as n from usage_reservations where round_id=${roundId} and state->>'kind'='reserved'`;
        await store.renewServiceInstance({ instanceId, role: 'web' });
        await Promise.all([release(), release()]);
        const released =
          await f.sql`select id,source,state,binding_released_at from usage_reservations where round_id=${roundId} order by kind`;
        await release();
        const replay =
          await f.sql`select id,source,state,binding_released_at from usage_reservations where round_id=${roundId} order by kind`;
        assert({
          given:
            'a rediscovered abandoned selected bundle, duplicate workers and replay',
          should:
            'release once under the normal control lane and preserve old terminal IDs and binding-release time',
          actual: [
            pending.candidates,
            unchanged.n,
            released.map((row: { state: { kind: string } }) => row.state.kind),
            replay,
            (await page()).candidates,
          ],
          expected: [
            [{ actorId, roundId }],
            2,
            ['released', 'released'],
            released,
            [],
          ],
        });
        const next = await admission.reserve({ actorId, roundId: replacement });
        assert({
          given: 'a fresh Round after successful scheduled bundle release',
          should:
            'receive new admission without reviving the abandoned identity',
          actual: next.roundId,
          expected: replacement,
        });
      } finally {
        await f.sql`delete from service_instances where instance_id=${instanceId}`;
      }
    },
  );
});

test('recovery loses service authority while waiting on the account fence', async () => {
  await withFreeBundle(async ({ f, run, actorId, roundId }) => {
    const store = createDatabase({
      url: databaseUrl,
      client: f.sql,
      nextActorId: createId,
    });
    const instanceId = createId();
    await f.sql`update rounds set status='abandoned',completed_at=clock_timestamp() where id=${roundId}`;
    await store.renewServiceInstance({ instanceId, role: 'web' });
    const before =
      await f.sql`select id,state,binding_released_at from usage_reservations where round_id=${roundId} order by kind`;
    try {
      await withHeldCommit(run, async (held) => {
        const holder = held.observe(
          held.run(async (tx) => {
            await lockAuthorizationActors(tx, [actorId], { maxActors: 1 });
          }),
        );
        const pid = await held.entered;
        const release = held.observe(
          store.releaseAbandonedUsage(
            { instanceId, actorId, roundId },
            canReleaseFreeJudgeBinding,
          ),
        );
        try {
          assert({
            given:
              'a current recovery service and a held account authority fence',
            should: 'wait behind that real PostgreSQL fence',
            actual: await finishedOrBlockedBehind(release, f.sql, pid, {
              now: performance.now,
              deadlineMs: 1000,
            }),
            expected: 'blocked',
          });
          await f.sql`update service_instances set renewed_at=clock_timestamp()-interval '4 seconds' where instance_id=${instanceId}`;
        } finally {
          held.release();
        }
        await holder;
        await assertRejects({
          given: 'service authority expires during the real lock wait',
          should: 'refuse the release at the transaction completion fence',
          code: 'AUTHORIZATION',
          actual: () => release,
        });
        assert({
          given: 'the stale recovery transaction attempted the entire bundle',
          should: 'roll back release and binding changes together',
          actual:
            await f.sql`select id,state,binding_released_at from usage_reservations where round_id=${roundId} order by kind`,
          expected: before,
        });
      });
    } finally {
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  });
});
