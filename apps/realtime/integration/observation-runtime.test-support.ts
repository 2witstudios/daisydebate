import { SQL } from 'bun';
import { createHash, randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { systemClock, systemId } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import { createMessagingTestFixture } from '@daisy/db/testing';
import { messagingTestReading } from '@daisy/auth/testing';
import { testNamespace } from '@daisy/redis/testing';
import { ENVELOPE_VERSION } from '@daisy/protocol';
import { openAuthorityPeer } from './authority-peer.test-support';
import { createRealtimeApp } from '../src/app';
import { serveRealtime } from '../src/serve';
import { removeSessionControls, testOrigin } from './support';

type Frame = Record<string, unknown> & { readonly type: string };
/** A pool bound to one restricted runtime role; never the fixture owner. */
async function restricted(
  url: string,
  role: 'daisy_realtime' | 'daisy_projection',
) {
  const client = new SQL(url, { max: 1 });
  await client.unsafe(`set role ${role}`);
  const [bound] = await client`select current_user as role`;
  if (bound?.role !== role) throw new Error('Restricted role binding refused');
  return createDatabase({
    url,
    client,
    workloadProfile: role === 'daisy_realtime' ? 'realtime' : 'projection',
    maxConnections: 4,
    nextActorId: () => systemId.next(),
  });
}

/** Actual native runtime: restricted realtime and projection roles, real
 * Redis cache/PubSub, a durable DM and a far-future durable session. */
export async function observationRuntimeFixture() {
  const services = requireTestServices(process.env);
  const admin = new SQL(services.databaseUrl, { max: 2 });
  const messaging = await createMessagingTestFixture(admin);
  const sessionId = systemId.next();
  const projection = await restricted(services.databaseUrl, 'daisy_projection');
  const resources = createRealtimeApp({
    database: await restricted(services.databaseUrl, 'daisy_realtime'),
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: services.databaseUrl,
      REDIS_URL: services.redisUrl,
      REDIS_NAMESPACE: testNamespace(systemId.next()),
      LOG_LEVEL: 'silent',
      REALTIME_ALLOWED_ORIGINS: testOrigin,
    },
    clock: systemClock,
    ids: systemId,
  });
  await admin`insert into session(id,user_id,token,expires_at)
    values(${sessionId},${messaging.userId},${randomBytes(32).toString('base64url')},'2099-01-01T00:00:00Z')`;
  const runtime = await serveRealtime({
    resources,
    port: 0,
    hostname: '127.0.0.1',
    readingPolicy: messagingTestReading,
    observation: {
      projection,
      channelBounds: { messageUnits: 100, pageItems: 50 },
    },
  });
  let sequence = 0;
  async function connect() {
    const ticket = randomBytes(32).toString('base64url');
    await resources.redis.issueConnectTicket(
      createHash('sha3-256').update(ticket).digest('hex'),
      { actorId: messaging.actorId, sessionId, origin: testOrigin },
      60,
    );
    const peer = await openAuthorityPeer(Number(runtime.server.port), ticket);
    const { socket } = peer;
    const frames = peer.frames as unknown as Frame[];
    return {
      frames,
      observe(id: string) {
        socket.send(
          JSON.stringify({
            v: ENVELOPE_VERSION,
            type: 'observe',
            id,
            resource: { kind: 'channel', id: messaging.channelId },
            window: { after: null, limit: 50 },
          }),
        );
      },
      snapshots: () =>
        frames.filter((frame) => frame.type === 'observation.snapshot'),
      close: () => socket.close(),
    };
  }
  return {
    messaging,
    admin,
    runtime,
    connect,
    /** One durable message commit, advancing the channel's content revision. */
    async post(text: string) {
      sequence++;
      await admin.begin(async (tx) => {
        await tx`update messaging_channels set message_sequence=${sequence},change_version=${sequence} where id=${messaging.channelId}`;
        await tx`insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at)
          values(${systemId.next()},${messaging.channelId},${messaging.otherActorId},${sequence},${sequence},${text},now())`;
      });
    },
    async close() {
      await runtime.close();
      await resources.close();
      await projection.close();
      await admin`delete from messaging_messages where channel_id=${messaging.channelId}`;
      await admin`delete from session where id=${sessionId}`;
      await removeSessionControls(admin, [messaging.actorId]);
      await messaging.cleanup();
      await admin.close();
    },
  };
}
