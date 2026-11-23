import { sha3Hex } from '@daisy/digest';
import { SQL } from 'bun';
import { admitParticipants } from '@daisy/db/testing';
import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { instantMs, systemId } from '@daisy/clock';
import { openAuthorityPeer } from './authority-peer.test-support';
import { authorityResources } from './authority-resources.test-support';
import { serveRealtime } from '../src/serve';
import type { RealtimeReadingPolicy } from '../src/authorization';
import { heldCadence, testOrigin } from './support';
import { refuseAllReading } from '../src/authorization.test-support';

/** One admitted participant's durable rows, written and erased by an administrative client. */
export function authorityParticipant(client: SQL) {
  const userId = systemId.next(),
    actorId = systemId.next(),
    sessionId = systemId.next();
  return {
    userId,
    actorId,
    sessionId,
    async seed() {
      await client`insert into users(id,username,email_verified) values(${userId},${userId},true)`;
      await client`insert into actors(id,kind,user_id) values(${actorId},'human',${userId})`;
      // An admitted participant (ADR 0075); deleting the user cascades.
      await admitParticipants(client, [userId]);
      await client`insert into session(id,user_id,token,expires_at) values(${sessionId},${userId},${randomBytes(32).toString('base64url')},'2026-10-09T01:00:00Z')`;
    },
    async erase() {
      await client`delete from session where id=${sessionId}`;
      await client`delete from actors where id=${actorId}`;
      await client`delete from users where id=${userId}`;
    },
  };
}

/** Durable isolated identity; authority always comes from the actual session/account readers. */
export async function socketAuthorityFixture(
  serve?: typeof Bun.serve,
  maxSubscriptions = 64,
  afterCatchup?: () => Promise<void>,
  readingPolicy?: RealtimeReadingPolicy,
) {
  const services = requireTestServices(process.env);
  const client = new SQL(services.databaseUrl);
  const participant = authorityParticipant(client);
  const { userId, actorId, sessionId } = participant;
  const initial = instantMs('2026-10-09T00:00:00.000Z');
  let elapsed = 0;
  const revalidation = heldCadence(50_000);
  const resources = await authorityResources(
    services,
    { now: () => new Date(initial + elapsed).toISOString() },
    maxSubscriptions,
    afterCatchup,
  );
  let runtime: Awaited<ReturnType<typeof serveRealtime>> | undefined;
  try {
    await participant.seed();
    runtime = await serveRealtime({
      resources,
      ...(serve ? { serve } : {}),
      readingPolicy: readingPolicy ?? refuseAllReading,
      port: 0,
      hostname: '127.0.0.1',
      now: () => elapsed,
      waits: revalidation.waits,
    });
    return {
      resources,
      runtime,
      sessionId,
      actorId,
      userId,
      client,
      advanceToRevalidation() {
        elapsed = 50_000;
        if (!revalidation.fire())
          throw new Error('Actual revalidation timer unavailable');
      },
      async close() {
        await runtime?.close();
        await resources.close();
        await participant.erase();
        await client.close();
      },
    };
  } catch {
    await runtime?.close();
    await resources.close();
    await participant.erase();
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
  fixture: Pick<
    Awaited<ReturnType<typeof socketAuthorityFixture>>,
    'resources' | 'actorId' | 'sessionId'
  >,
) {
  const ticket = randomBytes(32).toString('base64url');
  await fixture.resources.redis.issueConnectTicket(
    sha3Hex(ticket),
    {
      actorId: fixture.actorId,
      sessionId: fixture.sessionId,
      origin: testOrigin,
    },
    60,
  );
  return ticket;
}
