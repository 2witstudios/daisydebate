import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createMessagingTestFixture } from '../src/testing';
import { createFriendStore, type FriendFrame } from '../src/friends';
import { createMessagingSocialStore } from '../src/messaging';

/** Two fixture members and the friend store, unfenced, over one client. */
export const openPairStore = async (databaseUrl: string) => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const store = createFriendStore({
    database,
    authorize: async () => {},
  });
  const frameFor = <T>(
    self: string,
    selfUser: string,
    work: (frame: FriendFrame) => Promise<T>,
  ) =>
    store.withContacts(
      {
        actorId: self,
        userId: selfUser,
        memberActorIds: [fixture.actorId!, fixture.otherActorId!],
      },
      work,
    );
  const members = [fixture.actorId!, fixture.otherActorId!];
  /** A block by `self` through messaging's contact store (ADR 0061). */
  const blockFor = (
    self: string,
    selfUser: string,
    command: { readonly blocked: boolean; readonly digest: string },
    now: string,
  ) =>
    createMessagingSocialStore({
      database,
      authorize: async () => {},
    }).withContacts(
      { actorId: self, userId: selfUser, memberActorIds: members },
      (frame) => frame.commitBlock({ requestId: createId(), ...command, now }),
    );
  return { client, database, fixture, frameFor, blockFor };
};

/** DEC-251's social request limits, as the beta policy composes them. */
export const socialLimits = {
  daily: 20,
  unrelatedHourly: 5,
  declinesToBlock: 3,
  declineBlockMs: 2_592_000_000,
};

/** The ledger id and limits every friendship change carries. */
export const friendCommand = () => ({
  requestId: createId(),
  limits: socialLimits,
});
