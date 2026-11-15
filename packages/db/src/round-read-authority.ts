import {
  readRoundRoomAuthority,
  type RoundRoomAuthority,
} from './round-room-authority';
import type { TabTransaction } from './tab/tab-transaction';
import { createAppError } from '@daisy/errors';
import type { LaunchedRound } from '@daisy/protocol';
import { sharedAccount, type Caller, type Account } from './room-command-facts';
import { launchedRoundRows } from './room-read-operations';
/** Canonical account fence followed by a fresh protected Round snapshot for private competitive reads. */
export async function readAuthorizedRound(
  tx: TabTransaction,
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
  const initial = await launchedRoundRows(tx, input.roundId);
  const owner = await readRoundRoomAuthority(tx, {
    roomId: initial.roomId,
    userId: input.caller.userId,
  });
  const round =
    owner.kind === 'event'
      ? await launchedRoundRows(tx, input.roundId)
      : initial;
  if (!input.authorize(round, account, owner))
    throw createAppError('NOT_FOUND');
  return { round, account, owner };
}
