import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createMessagingTestFixture } from '@daisy/db/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { composeMessagingTyping } from '../src/features/messaging/typing-operations';
import { loadAccountPolicyFacts } from '../src/features/authorization/account-policy-facts';
import { messagingRoutePolicy } from './messaging-route.test-support';
import { createTestApp } from './fixtures';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('canonical typing rights export owns every lease and physical deletion job preserves peer state across outage', async () => {
  const app = createTestApp(),
    client = new SQL(databaseUrl),
    fixture = await createMessagingTestFixture(client),
    jobId = createId();
  const lease = {
    version: 1 as const,
    channelId: fixture.channelId,
    actorId: fixture.actorId,
    authorityRevision: 1,
    relationshipRevision: 1,
    accountRevision: 1,
    ageRevision: 1,
    policyRevision: 1,
    expiresAt: fixture.now,
  };
  const inaccessible = { ...lease, channelId: createId() },
    peer = { ...lease, actorId: fixture.otherActorId };
  let outage = true;
  const rights = app.app.database.messagingTypingPrivacyPort({
    exportSubject: (actorId) => app.app.redis.exportSubjectTyping(actorId),
    eraseSubject: async (actorId) => {
      if (outage) throw new Error('Vendor unavailable');
      await app.app.redis.eraseSubjectTyping(actorId);
    },
  });
  const subject = { userId: fixture.userId, actorId: fixture.actorId };
  const delivery = {
    jobId,
    now: fixture.now,
    retryAt: '2026-10-09T18:01:00.000Z',
  };
  try {
    for (const value of [lease, inaccessible, peer])
      await app.app.redis.writeTypingLease(value, 60000);
    const exported = await rights.export(subject);
    assert({
      given:
        'real durable bound subject plus retained expired leases in accessible and inaccessible channels',
      should:
        'export only own strict leases without Redis keys or peer association',
      actual: exported,
      expected: [lease, inaccessible].sort((a, b) =>
        a.channelId.localeCompare(b.channelId),
      ),
    });
    await fixture.eraseSubject(fixture.actorId, jobId);
    const failed = await fixture.deliverTypingJob(delivery, rights),
      retained = await app.app.redis.exportSubjectTyping(fixture.actorId);
    outage = false;
    const retry = {
      ...delivery,
      now: delivery.retryAt,
      retryAt: '2026-10-09T18:02:00.000Z',
    };
    const succeeded = await fixture.deliverTypingJob(retry, rights),
      idle = await fixture.deliverTypingJob(retry, rights);
    const rows = await client.unsafe(
      'select status,attempts from privacy_jobs where id=$1',
      [jobId],
    );
    assert({
      given:
        'committed erasure with real vendor intent, outage then successful cursor-complete physical deletion',
      should:
        'retain charge-free lease work for retry and preserve every peer lease',
      actual: [
        failed,
        retained.length,
        succeeded,
        idle,
        await app.app.redis.exportSubjectTyping(fixture.actorId),
        await app.app.redis.exportSubjectTyping(fixture.otherActorId),
        rows[0],
      ],
      expected: [
        'retry',
        2,
        'succeeded',
        'idle',
        [],
        [peer],
        { status: 'succeeded', attempts: 2 },
      ],
    });
  } finally {
    try {
      await Promise.all(
        [fixture.actorId, fixture.otherActorId].map((actor) =>
          app.app.redis.eraseSubjectTyping(actor),
        ),
      );
      await client.unsafe(
        'delete from privacy_jobs where id=$1 and subject_ref=$2',
        [jobId, fixture.userId],
      );
      await fixture.cleanup();
    } finally {
      await client.close();
    }
  }
});

for (const writeFirst of [true, false]) {
  test(`typing erasure fence ${writeFirst ? 'writer wins' : 'erasure wins'} never resurrects subject leases`, async () => {
    const app = createTestApp(),
      client = new SQL(databaseUrl),
      fixture = await createMessagingTestFixture(client),
      jobId = createId();
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const rights = app.app.database.messagingTypingPrivacyPort({
      exportSubject: (actorId) => app.app.redis.exportSubjectTyping(actorId),
      eraseSubject: (actorId) => app.app.redis.eraseSubjectTyping(actorId),
    });
    const redis = {
      readTypingLeases: app.app.redis.readTypingLeases,
      clearTypingLease: app.app.redis.clearTypingLease,
      writeTypingLease: async (
        ...args: Parameters<typeof app.app.redis.writeTypingLease>
      ) => {
        entered.resolve();
        await release.promise;
        return app.app.redis.writeTypingLease(...args);
      },
    };
    const operation = composeMessagingTyping({
      database: app.app.database,
      redis,
      clock: { now: () => fixture.now },
      policy: messagingRoutePolicy,
      bounds: { ttlMs: 60000, refetchMs: 1000, maxActors: 2 },
      principal: {
        kind: 'user',
        userId: fixture.userId,
        actorId: fixture.actorId,
      },
      readAccounts: loadAccountPolicyFacts,
    });
    let writing: ReturnType<typeof operation.update> | undefined,
      erasing: ReturnType<typeof fixture.eraseSubject> | undefined;
    try {
      if (writeFirst) {
        writing = operation.update(fixture.channelId, true);
        void writing.catch(entered.reject);
        await entered.promise;
        const probe = new SQL(databaseUrl, { max: 1 });
        try {
          let refused = false;
          await probe.unsafe('begin');
          try {
            await probe.unsafe(
              'select id from users where id=$1 for update nowait',
              [fixture.userId],
            );
          } catch (error) {
            refused =
              typeof error === 'object' &&
              error !== null &&
              'errno' in error &&
              error.errno === '55P03';
          } finally {
            await probe.unsafe('rollback');
          }
          assert({
            given: 'typing writer paused before real Redis SET',
            should: 'hold the same durable account lock against erasure',
            actual: refused,
            expected: true,
          });
        } finally {
          await probe.close();
        }
        erasing = fixture.eraseSubject(fixture.actorId, jobId);
        release.resolve();
        await writing;
        await erasing;
        assert({
          given: 'writer committed before the waiting canonical erasure',
          should: 'leave physical vendor work until canonical deletion ACK',
          actual: (await app.app.redis.exportSubjectTyping(fixture.actorId))
            .length,
          expected: 1,
        });
      } else {
        await fixture.eraseSubject(fixture.actorId, jobId);
      }
      await assertRejects({
        given: 'canonical erasure has committed and removed pair authority',
        should: 'refuse a new write before any Redis resurrection',
        actual: () => operation.update(fixture.channelId, true),
        code: 'NOT_FOUND',
      });
      const delivered = await fixture.deliverTypingJob(
        { jobId, now: fixture.now, retryAt: '2026-10-09T18:01:00.000Z' },
        rights,
      );
      assert({
        given: 'both real account-fence orders and physical subject deletion',
        should: 'finish only after ACK and leave no subject lease',
        actual: [
          delivered,
          await app.app.redis.exportSubjectTyping(fixture.actorId),
        ],
        expected: ['succeeded', []],
      });
    } finally {
      release.resolve();
      await writing?.catch(() => {});
      await erasing?.catch(() => {});
      await app.app.redis.eraseSubjectTyping(fixture.actorId);
      await client.unsafe(
        'delete from privacy_jobs where id=$1 and subject_ref=$2',
        [jobId, fixture.userId],
      );
      await fixture.cleanup();
      await client.close();
    }
  });
}
