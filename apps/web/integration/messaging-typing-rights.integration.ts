import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createMessagingTestFixture } from '@daisy/db/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
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
