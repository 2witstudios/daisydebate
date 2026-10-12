import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createObservationAuthorityOperations } from '../src/observation-authority';
import {
  createWorkloadExecutor,
  workloadDatabase,
} from '../src/workload-executor';
import { withFixture } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
test('named authority batches preserve semantic evidence across content while checking exact current session and purge', async () => {
  await withFixture(url, async (f) => {
    const principal = {
      ...(await createAuthorizationSubject(f)),
      sessionId: createId(),
    };
    await f.insert('session', {
      id: principal.sessionId,
      user_id: principal.userId,
      token: createId(),
      expires_at: new Date('2099-01-01'),
    });
    const id = await f.round({
      created_by_actor_id: principal.actorId,
      visibility: 'public',
    });
    const db = drizzle({ client: f.sql }),
      executor = createWorkloadExecutor({ admission: 1, renewal: 1 });
    const operations = createObservationAuthorityOperations(
      {
        admission: workloadDatabase(db, executor, 'admission'),
        renewal: workloadDatabase(db, executor, 'renewal'),
      },
      (context) => ({
        status: 'allowed',
        partition: { kind: 'shared', policyKey: 'round-clock-v1' },
        dependencies: [
          {
            key: 'round',
            revision: String(
              context.resourceFact.kind === 'round'
                ? context.resourceFact.revision
                : 0,
            ),
            nextBoundary: null,
          },
        ],
        eligibleUntil: null,
        overlay: null,
      }),
    );
    const binding = {
      principal,
      resource: { kind: 'round' as const, id },
      window: { after: null, limit: 1 },
    };
    const [first] = await operations.admitObservationAuthorityBatch([binding]);
    await f.sql`update rounds set resolution='Fresh body',version=version+1 where id=${id}`;
    const [renewed] = await operations.renewObservationAuthorityBatch([
      binding,
    ]);
    for (const role of ['daisy_web', 'daisy_realtime']) {
      const owner: Pick<BunSQLDatabase, 'transaction'> = {
        transaction: (work, options) =>
          db.transaction(async (tx) => {
            await tx.execute(sql.raw(`set local role ${role}`));
            return work(tx);
          }, options),
      };
      const actualRole = createObservationAuthorityOperations(
        { admission: owner, renewal: owner },
        (context) => ({
          status: 'allowed',
          partition: { kind: 'shared', policyKey: 'round-clock-v1' },
          dependencies: [],
          eligibleUntil: null,
          overlay: { resource: context.resourceFact.kind },
        }),
      );
      const [result] = await actualRole.admitObservationAuthorityBatch([
        binding,
      ]);
      assert({
        given: `the actual ${role} grants and named authority operation`,
        should: 'read only permitted current dependency facts',
        actual: result?.status,
        expected: 'allowed',
      });
    }
    await f.sql`update session set expires_at='2000-01-01' where id=${principal.sessionId}`;
    const [expired] = await operations.renewObservationAuthorityBatch([
      binding,
    ]);
    assert({
      given: 'content change followed by actual session expiry',
      should:
        'keep semantic authority identity, return current content/purge, and definitively deny expired binding',
      actual:
        first?.status === 'allowed' && renewed?.status === 'allowed'
          ? {
              sameBase:
                JSON.stringify(first.base) === JSON.stringify(renewed.base),
              sameCohort:
                first.cohort.fingerprint === renewed.cohort.fingerprint,
              newer:
                renewed.minimumContentRevision > first.minimumContentRevision,
              purge: renewed.purgeGeneration,
              remaining:
                renewed.subject.remainingMs > 0 &&
                renewed.subject.remainingMs <= 5000,
              expired: expired?.status,
            }
          : { first, renewed },
      expected: {
        sameBase: true,
        sameCohort: true,
        newer: true,
        purge: 0,
        remaining: true,
        expired: 'denied',
      },
    });
    const unavailable = createObservationAuthorityOperations(
      {
        admission: workloadDatabase(
          db,
          createWorkloadExecutor({}),
          'admission',
        ),
        renewal: workloadDatabase(db, createWorkloadExecutor({}), 'renewal'),
      },
      () => ({ status: 'denied' }),
    );
    assert({
      given: 'no available admission reservation',
      should: 'distinguish infrastructure from policy denial',
      actual: await unavailable.admitObservationAuthorityBatch([binding]),
      expected: [{ status: 'unavailable' }],
    });
  });
});
