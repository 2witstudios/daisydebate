import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createMessagingTestFixture } from '../src/testing';
import { createMessagingSocialStore } from '../src/messaging';
import type { MessagingSocialFrame } from '../src/messaging/social-contracts';

/** Two fixture members and the social store, unfenced, over one client. */
export const openPairStore = async (databaseUrl: string) => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const store = createMessagingSocialStore({
    database,
    authorize: async () => {},
  });
  const frameFor = <T>(
    self: string,
    selfUser: string,
    work: (frame: MessagingSocialFrame) => Promise<T>,
  ) =>
    store.withContacts(
      {
        actorId: self,
        userId: selfUser,
        memberActorIds: [fixture.actorId!, fixture.otherActorId!],
      },
      work,
    );
  return { client, database, fixture, frameFor };
};
