import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  withContactPairs,
  type ContactAuthorizationFence,
} from '../contacts/fence';
import { challengeFrame } from './challenge-frame';
import type { ContactReactions } from '../contacts/reactions';
import type { FriendStore } from './contracts';
import { friendshipFrame } from './friendship-frame';

/** Friendships and challenges over the shared Contacts fence (ADR 0072). */
export function createFriendStore({
  database,
  authorize,
  reactions,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: ContactAuthorizationFence;
  readonly reactions: ContactReactions;
}): FriendStore {
  return {
    withContacts: (input, work) =>
      withContactPairs(
        database,
        authorize,
        input,
        async (tx, { rows, contacts, refresh }) =>
          work({
            contacts,
            ...friendshipFrame(tx, input, rows, refresh, reactions.relations),
            ...challengeFrame(tx, input, rows, refresh),
          }),
      ),
  };
}
