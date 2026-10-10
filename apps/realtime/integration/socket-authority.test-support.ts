import { SQL } from 'bun';
import { createHash, randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { systemId } from '@daisy/clock';
import { openAuthorityPeer } from './authority-peer.test-support';
import { authorityResources } from './authority-resources.test-support';
import { serveRealtime } from '../src/serve';
import type { RealtimeReadingPolicy } from '../src/authorization';
import { testOrigin } from './support';

/** Durable isolated identity; authority always comes from the actual session/account readers. */
export async function socketAuthorityFixture(
  serve?: typeof Bun.serve,
  maxSubscriptions = 64,
  afterCatchup?: () => Promise<void>,
  readingPolicy?: RealtimeReadingPolicy,
) {
  const services = requireTestServices(process.env);
  const client = new SQL(services.databaseUrl);
  const userId = systemId.next(),
    actorId = systemId.next(),
    sessionId = systemId.next();
  const initial = Date.parse('2026-10-09T00:00:00.000Z');
  let elapsed = 0;
  let revalidate: (() => void) | undefined;
  const resources = await authorityResources(
    services,
    { now: () => new Date(initial + elapsed).toISOString() },
    maxSubscriptions,
    afterCatchup,
  );
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
      ...(readingPolicy ? { readingPolicy } : {}),
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
  const port = fixture.runtime.server.port;
  if (port === undefined)
    throw new Error('Actual authority listener unavailable');
  const peer = await openAuthorityPeer(
    port,
    await issueAuthorityTicket(fixture),
  );
  await peer.subscribe('standings:authority-proof', 'authority-proof', since);
  return peer;
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
