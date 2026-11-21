import {
  readRoundRoomAuthority,
  type RoundRoomAuthority,
} from './round-room-authority';
import { createAppError } from '@daisy/errors';
import type { LaunchedRound } from '@daisy/protocol';
import { sharedAccount, type Caller, type Account } from './room-command-facts';
import { launchedRoundRows } from './launched-round-read';
import { eq } from 'drizzle-orm';
import { rounds } from './schema/rounds';
import { readDatabaseTime } from './database-clock';
import type { Tx } from './tx';
/** Canonical account fence followed by a fresh protected Round snapshot for private competitive reads. */
export async function readAuthorizedRound(
  tx: Tx,
  input: {
    readonly roundId: string;
    readonly caller: Caller;
    readonly authorize: (
      round: LaunchedRound,
      account: Account,
      owner: RoundRoomAuthority,
    ) => boolean;
  },
) {
  const account = await sharedAccount(tx, input.caller);
  // Locate only the immutable Room source before parents; never hold a Round lock while waiting for its event parent.
  const [located] = await tx
    .select({ roomId: rounds.roomId })
    .from(rounds)
    .where(eq(rounds.id, input.roundId));
  if (!located?.roomId) throw createAppError('NOT_FOUND');
  const source = await readRoundRoomAuthority(tx, {
    roomId: located.roomId,
    userId: input.caller.userId,
  });
  if (
    source.kind === 'unavailable' ||
    (source.kind === 'event' && !source.direction)
  )
    throw createAppError('NOT_FOUND');
  const round = await launchedRoundRows(tx, input.roundId);
  if (round.roomId !== located.roomId)
    throw createAppError('CONFLICT', 'Round source changed');
  const owner: RoundRoomAuthority = {
    ...source,
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
  };
  if (!input.authorize(round, account, owner))
    throw createAppError('NOT_FOUND');
  return { round, account, owner };
}
