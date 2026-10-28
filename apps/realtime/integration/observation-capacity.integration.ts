import { SQL } from 'bun';
import { randomBytes } from 'node:crypto';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { systemClock, systemId } from '@daisy/clock';
import { createRealtimeDatabase, WORKLOAD_PROFILES } from '@daisy/db';
import { createMessagingTestFixture } from '@daisy/db/testing';
import { messagingTestReading } from '@daisy/auth/testing';
import { testNamespace } from '@daisy/redis/testing';
import { buildUserInboxTopic } from '@daisy/protocol';
import { createRealtimeApp } from '../src/app';
import { startObservationRuntime } from '../src/observation/runtime';
import type { ObservationConnection } from '../src/observation/node';
import { testOrigin, waitFor } from './support';

setupRitewayBun();
const services = requireTestServices(process.env);

/** One message the way a writer commits it: the row, then one stream advance. */
async function appendMessage(admin: SQL, channelId: string, authorId: string) {
  const [stream] =
    await admin`select message_sequence::int as s, change_version::int as v
    from messaging_channel_streams where channel_id=${channelId}`;
  const sequence = stream.s + 1,
    version = stream.v + 1;
  await admin.begin(async (tx) => {
    await tx`insert into messaging_messages(id, channel_id, author_actor_id, sequence, change_version, text, created_at)
      values(${systemId.next()}, ${channelId}, ${authorId}, ${sequence}, ${version}, ${`m${sequence}`}, now())`;
    await tx`update messaging_channel_streams set message_sequence=${sequence}, change_version=${version}
      where channel_id=${channelId}`;
  });
  return version;
}

type Viewer = {
  readonly connection: ObservationConnection;
  readonly member: 'a' | 'b';
  revision: number;
  /** performance.now() of the newest snapshot this viewer received. */
  lastSnapshotAt: number;
  revoked: boolean;
};

/**
 * RT-2.3c-arch1, RT-2.5c-arch1 (ADR 0089): 500 viewer sessions of one
 * conversation on one realtime process, through the real node, owner,
 * Redis cache and Pub/Sub subscriber, the restricted `daisy_realtime` role
 * and real PostgreSQL. It measures commit → last viewer's enqueue for a new
 * message, and committed revocation → the revoked viewers' last enqueue.
 */
test('500 viewers of one channel: every viewer gets each revision, and revocation stops enqueue within 5s', async () => {
  const admin = new SQL(services.databaseUrl);
  const fixture = await createMessagingTestFixture(admin);
  const sessionIds: string[] = [];
  const client = new SQL(services.databaseUrl, { max: 1 });
  await client.unsafe('set role daisy_realtime');
  const resources = createRealtimeApp({
    database: createRealtimeDatabase({
      url: services.databaseUrl,
      client,
      profile: WORKLOAD_PROFILES['realtime-observer'],
    }),
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: services.databaseUrl,
      REDIS_URL: services.redisUrl,
      REDIS_NAMESPACE: testNamespace(systemId.next()),
      LOG_LEVEL: 'silent',
      REALTIME_ALLOWED_ORIGINS: testOrigin,
    },
    clock: systemClock,
  });
  let runtime: ReturnType<typeof startObservationRuntime> | undefined;
  try {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const viewers: Viewer[] = [];
    for (let index = 0; index < 500; index++) {
      const member = index % 2 === 0 ? 'a' : 'b';
      const userId = member === 'a' ? fixture.userId : fixture.otherUserId;
      const actorId = member === 'a' ? fixture.actorId : fixture.otherActorId;
      const sessionId = systemId.next();
      sessionIds.push(sessionId);
      await admin`insert into session(id, user_id, token, expires_at)
        values(${sessionId}, ${userId}, ${randomBytes(32).toString('base64url')}, ${expiresAt})`;
      const viewer: Viewer = {
        member,
        revision: -1,
        lastSnapshotAt: 0,
        revoked: false,
        connection: {
          principal: { actorId, userId, sessionId },
          sendText: (text) => {
            const frame = JSON.parse(text);
            if (frame.type === 'observation.snapshot') {
              viewer.revision = Math.max(
                viewer.revision,
                frame.contentRevision,
              );
              viewer.lastSnapshotAt = performance.now();
            }
            if (frame.type === 'observation.state' && frame.state === 'revoked')
              viewer.revoked = true;
            return true;
          },
        },
      };
      viewers.push(viewer);
    }
    runtime = startObservationRuntime({
      resources,
      readingPolicy: messagingTestReading,
      timers: { setInterval, clearInterval },
      now: () => performance.now(),
      nextId: () => systemId.next(),
    });
    const resource = {
      kind: 'channel-messages' as const,
      id: fixture.channelId,
    };
    for (const [index, viewer] of viewers.entries())
      runtime.node.observe(viewer.connection, { id: `o-${index}`, resource });
    await waitFor(() => viewers.every((v) => v.revision >= 0), 15_000);

    const committedAt = performance.now();
    const revision = await appendMessage(
      admin,
      fixture.channelId,
      fixture.actorId,
    );
    await waitFor(() => viewers.every((v) => v.revision >= revision), 10_000);
    const warmMs =
      Math.max(...viewers.map((v) => v.lastSnapshotAt)) - committedAt;

    // Member b loses every session: renewal must stop their enqueue within 5s.
    for (const viewer of viewers.filter((v) => v.member === 'b'))
      await admin`delete from session where id=${viewer.connection.principal.sessionId}`;
    const revokedAt = performance.now();
    let latest = revision;
    while (performance.now() - revokedAt < 6_000) {
      latest = await appendMessage(admin, fixture.channelId, fixture.actorId);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await waitFor(
      () =>
        viewers
          .filter((v) => v.member === 'a')
          .every((v) => v.revision >= latest),
      10_000,
    );
    const revoked = viewers.filter((v) => v.member === 'b');
    const lastRevokedEnqueueMs =
      Math.max(...revoked.map((v) => v.lastSnapshotAt)) - revokedAt;
    assert({
      given:
        '500 viewer sessions of one DM, a new message, then one member losing every session',
      should:
        'deliver the revision to every viewer within 1s, keep delivering to the remaining member, and stop the revoked viewers within 5s of the commit with a revoked state',
      actual: {
        warmWithin1s: warmMs <= 1_000,
        remainingCurrent: viewers
          .filter((v) => v.member === 'a')
          .every((v) => v.revision >= latest),
        revokedWithin5s: lastRevokedEnqueueMs <= 5_000,
        revokedReported: revoked.every((v) => v.revoked),
        revokedBehind: revoked.every((v) => v.revision < latest),
        interests: runtime.node.stats().resources,
      },
      expected: {
        warmWithin1s: true,
        remainingCurrent: true,
        revokedWithin5s: true,
        revokedReported: true,
        revokedBehind: true,
        interests: 1,
      },
    });
  } finally {
    runtime?.close();
    for (const id of sessionIds)
      await admin`delete from session where id=${id}`;
    await admin`delete from outbox where kind='session.revoked' and topic in (${buildUserInboxTopic(fixture.actorId)}, ${buildUserInboxTopic(fixture.otherActorId)})`;
    await fixture.cleanup();
    await resources.close();
    await admin.close();
  }
}, 60_000);
