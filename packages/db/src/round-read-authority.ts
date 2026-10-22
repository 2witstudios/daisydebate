import { createAppError } from '@daisy/errors';
import type { LaunchedRound } from '@daisy/protocol';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { sharedAccount, type Caller, type Account } from './room-command-facts';
import { launchedRoundRows } from './room-read-operations';
/** Canonical account fence followed by a fresh protected Round snapshot for private competitive reads. */
export async function readAuthorizedRound(
  tx: Pick<BunSQLDatabase, 'select' | 'execute'>,
  input: {
    readonly roundId: string;
    readonly caller: Caller;
    readonly authorize: (round: LaunchedRound, account: Account) => boolean;
  },
) {
  const account = await sharedAccount(tx, input.caller);
  const round = await launchedRoundRows(tx, input.roundId);
  if (!input.authorize(round, account)) throw createAppError('NOT_FOUND');
  return round;
}
