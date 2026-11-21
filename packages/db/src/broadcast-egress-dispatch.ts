import { and, eq, isNull } from 'drizzle-orm';
import { idSchema, isRoundRunning } from '@daisy/protocol';
import { broadcasts } from './schema/broadcasts';
import { rounds } from './schema/rounds';
import { readDatabaseTime } from './database-clock';
import { inTransaction, type TxSource } from './tx';

/** A vendor request is durably fenced before I/O; a lost answer cannot start another generation. */
export const beginBroadcastEgressAttempt = (
  database: TxSource,
  input: {
    readonly id: string;
    readonly generation: number;
    readonly stageCredentialHash: string;
  },
) =>
  inTransaction(database, async (tx) => {
    if (
      !idSchema.safeParse(input.id).success ||
      !Number.isSafeInteger(input.generation) ||
      input.generation < 1 ||
      !/^[0-9a-f]{64}$/.test(input.stageCredentialHash)
    )
      return false;
    const [own] = await tx
      .select()
      .from(broadcasts)
      .where(eq(broadcasts.id, input.id))
      .for('update');
    if (
      !own ||
      own.stoppedAt !== null ||
      own.completedAt !== null ||
      own.egressGeneration !== input.generation - 1 ||
      ((own.egressId !== null || own.egressDispatchedAt !== null) &&
        own.egressSettledAt === null)
    )
      return false;
    const [round] = await tx
      .select({ status: rounds.status })
      .from(rounds)
      .where(eq(rounds.id, own.roundId));
    if (!round || !isRoundRunning(round.status)) return false;
    await tx
      .update(broadcasts)
      .set({
        egressGeneration: input.generation,
        stageCredentialHash: input.stageCredentialHash,
        egressDispatchedAt: await readDatabaseTime(tx),
        egressSettledAt: null,
        egressId: null,
        egressStartedAt: null,
        revocationFailures: 0,
      })
      .where(eq(broadcasts.id, input.id));
    return true;
  });

/** Only the exact attempt's confirmed terminal observation settles physical work. */
export const settleBroadcastEgressAttempt = (
  database: TxSource,
  input: {
    readonly id: string;
    readonly generation: number;
    readonly egressId: string;
    readonly observation:
      | { readonly kind: 'complete' }
      | { readonly kind: 'failed'; readonly id: string };
  },
) =>
  inTransaction(database, async (tx) => {
    const [own] = await tx
      .select()
      .from(broadcasts)
      .where(eq(broadcasts.id, input.id))
      .for('update');
    if (
      !own ||
      own.egressId === null ||
      own.egressId !== input.egressId ||
      own.egressGeneration !== input.generation ||
      (input.observation.kind === 'failed' &&
        input.observation.id !== own.egressId)
    )
      return false;
    if (own.egressSettledAt !== null) return true;
    const rows = await tx
      .update(broadcasts)
      .set({ egressSettledAt: await readDatabaseTime(tx) })
      .where(
        and(eq(broadcasts.id, input.id), isNull(broadcasts.egressSettledAt)),
      )
      .returning({ id: broadcasts.id });
    return rows.length === 1;
  });
