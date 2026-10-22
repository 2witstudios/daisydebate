import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import type { BoundedTransaction } from '../src/bounded-transaction';
import type { BoundedTransactionContext } from '../src/transaction-context';
import {
  checkInAttemptLifecycle,
  type CheckInAttempt,
} from '../src/check-in-attempts';
import type { Fixture } from './constraint-helpers';
import { withBoundedRound } from './bounded-transaction.test-support';

export const withCheckInAttempt = (
  work: (input: {
    f: Fixture;
    run: BoundedTransaction;
    client: SQL;
    attempt: CheckInAttempt;
    lifecycle: ReturnType<typeof checkInAttemptLifecycle>;
  }) => Promise<void>,
) =>
  withBoundedRound(async (f, run, roundId, client) => {
    const attempt = {
      attemptId: createId(),
      commandId: createId(),
      roundId,
      actorId: await f.actor(),
      serviceId: null,
      payloadDigest: '11'.repeat(32),
    };
    await work({
      f,
      run,
      client,
      attempt,
      lifecycle: checkInAttemptLifecycle(attempt),
    });
  });

/** Primitive ledger fixture only; RT owns complete receipt/window acceptance. */
export const writeCheckInLedger = (
  tx: BoundedTransactionContext,
  attempt: CheckInAttempt,
) =>
  tx.execute(sql`insert into round_commands(command_id,round_id,actor_id,type,payload_digest,resulting_version,result,applied_at)
    values(${attempt.commandId},${attempt.roundId},${attempt.actorId},'check_in',${attempt.payloadDigest},1,'{}'::jsonb,clock_timestamp())`);
