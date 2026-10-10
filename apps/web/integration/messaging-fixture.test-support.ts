import { SQL } from 'bun';
import { createDatabase } from '@daisy/db';
import { createMessagingTestFixture } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';

export async function openMessagingFixture(databaseUrl: string) {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const database = createDatabase({ url: databaseUrl, nextActorId: createId });
  const principal = {
    kind: 'user' as const,
    userId: fixture.userId,
    actorId: fixture.actorId,
  };
  return { client, fixture, database, principal };
}

/** Current durable sender and counterpart identities for two-account proofs. */
export async function openMessagingParticipants(databaseUrl: string) {
  const opened = await openMessagingFixture(databaseUrl);
  return {
    ...opened,
    sender: opened.principal,
    recipient: {
      kind: 'user' as const,
      userId: opened.fixture.otherUserId,
      actorId: opened.fixture.otherActorId,
    },
  };
}

/** Shared teardown for group creation and preference revocation proofs; no production erasure claim. */
export async function closeMessagingGroupFixture(
  f: Awaited<ReturnType<typeof openMessagingFixture>>,
  channelId: string,
) {
  await f.client.unsafe('delete from messaging_channels where id=$1', [
    channelId,
  ]);
  await f.client.unsafe("delete from outbox where payload->>'channelId'=$1", [
    channelId,
  ]);
  await f.fixture.cleanup();
  await f.database.close();
  await f.client.close();
}
