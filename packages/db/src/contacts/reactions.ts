import type { SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

/** One canonical member pair, as Contacts names it to its consumers. */
export type ContactPairKey = {
  readonly lowActorId: string;
  readonly highActorId: string;
};

export type ContactTransaction = Pick<
  BunSQLDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;

/**
 * What each capability built on Contacts registers at the database
 * composition root, so Contacts never names a consumer's table:
 * - `onBlock` runs inside a block's transaction, after the pair's flag
 *   changes (Friends ends the friendship; Messaging advances DM authority);
 * - `relations` are SQL predicates, each true when its capability relates
 *   the pair (an accepted friendship, an accepted DM), for DEC-251's
 *   unrelated budget.
 */
export type ContactReactions = {
  readonly onBlock: readonly ((
    tx: ContactTransaction,
    pair: ContactPairKey,
    blocked: boolean,
  ) => Promise<void>)[];
  readonly relations: readonly ((pair: ContactPairKey) => SQL)[];
};
