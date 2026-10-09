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
