import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { createRoutes } from '../src/server/routes';
import { seedMessagingTestDm } from '@daisy/db/testing';
import {
  messagingTestPosting,
  messagingTestReading,
} from '@daisy/auth/testing';
import type { MessagingRuntimePolicy } from '../src/features/messaging/composition';
import { requireMessagingActor } from '../src/features/messaging/principal';
import { createAccountFlows, uniqueName } from './auth-account-helpers';
import { createTestApp } from './fixtures';
/** Two mounted suites use real signup/claim/session binding and the same isolated policy. */
export async function messagingRouteActors(
  app: ReturnType<typeof createTestApp>,
) {
  const accounts = createAccountFlows(app),
    first = await accounts.signUp(),
    second = await accounts.signUp();
  for (const account of [first, second])
    await accounts.claim(account.cookie, { username: uniqueName() });
  const principals = await Promise.all(
    [first, second].map(async (account) => {
      const identity = await accounts.identifyAs(account.cookie);
      if (identity.state !== 'member')
        throw new Error('Real mounted member required');
      return requireMessagingActor(identity.principal);
    }),
  );
  const [me, peer] = principals;
  if (!me || !peer) throw new Error('Mounted pair unavailable');
  return { first, second, me, peer };
}
export const messagingRoutePolicy: MessagingRuntimePolicy = {
  bounds: { messageUnits: 100, pageItems: 20 },
  maxBodyBytes: 1024,
  editWindowMs: 60000,
  posting: messagingTestPosting,
  reading: messagingTestReading,
  limits: {
    actorSend: { max: 10, windowSeconds: 60 },
    channelSend: { max: 10, windowSeconds: 60 },
    read: { max: 20, windowSeconds: 60 },
  },
};

export async function seedMessagingRouteDm(
  client: SQL,
  me: ReturnType<typeof requireMessagingActor>,
  peer: ReturnType<typeof requireMessagingActor>,
  channelId: string,
  now: string,
) {
  await client.unsafe(
    "insert into account_age(user_id,birth_month,version,recorded_at) values($1,'2000-01',1,$3),($2,'2000-01',1,$3)",
    [me.userId, peer.userId, now],
  );
  await seedMessagingTestDm(client, {
    actorId: me.actorId,
    otherActorId: peer.actorId,
    channelId,
    now,
  });
}

/** Native files and preferences share the same real mounted DM setup and scoped cleanup. */
export async function mountedMessagingPair(
  databaseUrl: string,
  extensions: Partial<
    Pick<Parameters<typeof createRoutes>[0], 'messagingFiles'>
  > = {},
) {
  const app = createTestApp();
  const actors = await messagingRouteActors(app);
  return {
    app,
    ...actors,
    client: new SQL(databaseUrl),
    channelId: createId(),
    routes: createRoutes({
      ...app.app,
      messagingPolicy: messagingRoutePolicy,
      ...extensions,
    }),
  };
}
export async function closeMountedMessagingPair(
  client: SQL,
  channelId: string,
  me: ReturnType<typeof requireMessagingActor>,
  peer: ReturnType<typeof requireMessagingActor>,
) {
  await client.unsafe('delete from messaging_channels where id=$1', [
    channelId,
  ]);
  await client.unsafe(
    'delete from messaging_contact_pairs where low_actor_id=$1 and high_actor_id=$2',
    [...[me.actorId, peer.actorId].sort()],
  );
  await client.unsafe("delete from outbox where payload->>'channelId'=$1", [
    channelId,
  ]);
  await client.unsafe('delete from account_age where user_id in ($1,$2)', [
    me.userId,
    peer.userId,
  ]);
}
