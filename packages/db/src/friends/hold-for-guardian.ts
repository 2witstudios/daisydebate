import { sql } from 'drizzle-orm';
import { mintNoticeIds } from '../notifications/mint-notice-ids';
import type { Tx } from '../tx';

/** The database writes the hold and its private notification as one operation. */
export async function holdForGuardian(
  tx: Pick<Tx, 'execute'>,
  input: {
    readonly pair: {
      readonly lowActorId: string;
      readonly highActorId: string;
    };
    readonly childActorId: string;
    readonly at: string;
    readonly nextId: () => string;
  },
) {
  const { pair, childActorId, at, nextId } = input;
  const args = sql`${nextId()}, ${pair.lowActorId}, ${pair.highActorId},
    ${childActorId}, ${at}::timestamptz`;
  return mintNoticeIds(tx, sql`public.daisy_hold_friend_request`, args, nextId);
}
