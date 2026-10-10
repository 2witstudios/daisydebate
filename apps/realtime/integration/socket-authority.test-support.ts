import { SQL } from 'bun';
import { createHash, randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { systemId } from '@daisy/clock';
import { testNamespace } from '@daisy/redis/testing';
import {
  serverMessageSchema,
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '@daisy/protocol';
import { createRealtimeApp } from '../src/app';
import { serveRealtime } from '../src/serve';
import { testOrigin, waitFor } from './support';

/** Durable isolated identity; authority always comes from the actual session/account readers. */
export async function socketAuthorityFixture(serve?: typeof Bun.serve) {
  const services = requireTestServices(process.env);
  const client = new SQL(services.databaseUrl);
  const userId = systemId.next(),
    actorId = systemId.next(),
    sessionId = systemId.next();
  const initial = Date.parse('2026-10-09T00:00:00.000Z');
  let elapsed = 0;
  let revalidate: (() => void) | undefined;
  const resources = createRealtimeApp({
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: services.databaseUrl,
      REDIS_URL: services.redisUrl,
      REDIS_NAMESPACE: testNamespace(systemId.next()),
      LOG_LEVEL: 'silent',
      REALTIME_ALLOWED_ORIGINS: testOrigin,
    },
    clock: { now: () => new Date(initial + elapsed).toISOString() },
    ids: systemId,
  });
  const eraseFixture = async () => {
    await client`delete from session where id=${sessionId}`;
    await client`delete from actors where id=${actorId}`;
    await client`delete from users where id=${userId}`;
  };
  let runtime: Awaited<ReturnType<typeof serveRealtime>> | undefined;
  try {
    await client`insert into users(id,username,email_verified) values(${userId},${userId},true)`;
    await client`insert into actors(id,kind,user_id) values(${actorId},'human',${userId})`;
    await client`insert into session(id,user_id,token,expires_at) values(${sessionId},${userId},${randomBytes(32).toString('base64url')},'2026-10-09T01:00:00Z')`;
    runtime = await serveRealtime({
      resources,
      ...(serve ? { serve } : {}),
      port: 0,
      hostname: '127.0.0.1',
      now: () => elapsed,
      timers: {
        setInterval: (callback, ms) => {
          if (ms === 50_000) revalidate = callback;
          return setInterval(callback, ms);
        },
        clearInterval,
      },
    });
    return {
      resources,
      runtime,
      sessionId,
      actorId,
      userId,
      client,
      advanceToRevalidation() {
        if (!revalidate)
          throw new Error('Actual revalidation timer unavailable');
        elapsed = 50_000;
        revalidate();
      },
      async close() {
        await runtime?.close();
        await resources.close();
        await eraseFixture();
        await client.close();
      },
    };
  } catch {
    await runtime?.close();
    await resources.close();
    await eraseFixture();
    await client.close();
    throw new Error('Realtime authority fixture unavailable');
  }
}

export async function authenticatedAuthorityPeer(
  fixture: Awaited<ReturnType<typeof socketAuthorityFixture>>,
  since?: string,
) {
  const ticket = await issueAuthorityTicket(fixture);
  const socket = new WebSocket(
    `ws://127.0.0.1:${fixture.runtime.server.port}/ws`,
    { headers: { origin: testOrigin } },
  );
  const frames: ServerMessage[] = [];
  const closed = new Promise<number>((accept) =>
    socket.addEventListener('close', (event) => accept(event.code)),
  );
  socket.addEventListener('message', (event) => {
    const frame = serverMessageSchema.parse(JSON.parse(String(event.data)));
    frames.push(frame);
  });
  socket.addEventListener('open', () =>
    socket.send(
      JSON.stringify({
        v: ENVELOPE_VERSION,
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        ticket,
      }),
    ),
  );
  await waitFor(() => frames.some((frame) => frame.type === 'ready'));
  socket.send(
    JSON.stringify({
      v: ENVELOPE_VERSION,
      type: 'subscribe',
      id: 'authority-proof',
      topic: 'standings:authority-proof',
      ...(since ? { since } : {}),
    }),
  );
  await waitFor(() => frames.some((frame) => frame.type === 'subscribed'));
  return { socket, frames, closed };
}

export async function issueAuthorityTicket(
  fixture: Awaited<ReturnType<typeof socketAuthorityFixture>>,
) {
  const ticket = randomBytes(32).toString('base64url');
  await fixture.resources.redis.issueConnectTicket(
    createHash('sha3-256').update(ticket).digest('hex'),
    {
      actorId: fixture.actorId,
      sessionId: fixture.sessionId,
      origin: testOrigin,
    },
    60,
  );
  return ticket;
}
