import { instantMs } from '@daisy/clock';
import { and, eq, isNull } from 'drizzle-orm';
import { isRoundRunning } from '@daisy/protocol/round';
import { idSchema } from '@daisy/protocol/primitives';
import { recordingCaptures as captures } from './schema/recording-captures';
import { recordings } from './schema/recordings';
import { rounds } from './schema/rounds';
import { readDatabaseTime } from './database-clock';
import { readRecordingTournamentAdmission } from './recording-tournament-admission';
import { readLockedTournamentAdmission } from './recording-tournament-admission';
import { inTransaction, type TxSource } from './tx';

/** Durable dispatch precedes vendor I/O, so a lost answer cannot authorize a second Egress. */
export const beginRecordingEgressAttempt = (
  database: TxSource,
  input: {
    readonly recordingId: string;
    readonly generation: number;
    readonly stageCredentialHash: string;
  },
) =>
  inTransaction(database, async (tx) => {
    if (
      !idSchema.safeParse(input.recordingId).success ||
      !Number.isSafeInteger(input.generation) ||
      input.generation < 1 ||
      !/^[0-9a-f]{64}$/.test(input.stageCredentialHash)
    )
      return false;
    const [address] = await tx
      .select({ roundId: recordings.roundId })
      .from(recordings)
      .where(eq(recordings.id, input.recordingId));
    if (!address) return false;
    await readLockedTournamentAdmission(tx, address.roundId);
    const [recording] = await tx
      .select()
      .from(recordings)
      .where(eq(recordings.id, input.recordingId))
      .for('update');
    if (!recording) return false;
    const [own] = await tx
      .select()
      .from(captures)
      .where(eq(captures.recordingId, input.recordingId))
      .for('update');
    if (
      !own ||
      own.endedAt !== null ||
      own.egressGeneration !== input.generation - 1
    )
      return false;
    if (
      (own.egressId !== null || own.egressDispatchedAt !== null) &&
      own.egressSettledAt === null
    )
      return false;
    const [round] = await tx
      .select({ status: rounds.status })
      .from(rounds)
      .where(eq(rounds.id, recording.roundId));
    const admission = await readRecordingTournamentAdmission(
        tx,
        recording.roundId,
      ),
      now = await readDatabaseTime(tx);
    if (
      !round ||
      !isRoundRunning(round.status) ||
      !['requested', 'capturing'].includes(recording.status)
    )
      return false;
    if (
      recording.eligibility.kind === 'tournament_admission' &&
      (!admission ||
        admission.admissionId !== recording.eligibility.admissionId ||
        now.getTime() >= instantMs(admission.deadlineAt))
    )
      return false;
    const rows = await tx
      .update(captures)
      .set({
        egressGeneration: input.generation,
        egressDispatchedAt: now,
        egressSettledAt: null,
        egressId: null,
        egressStartedAt: null,
        stageCredentialHash: input.stageCredentialHash,
        revocationFailures: 0,
      })
      .where(eq(captures.recordingId, input.recordingId))
      .returning({ id: captures.recordingId });
    return rows.length === 1;
  });

/** A confirmed terminal vendor observation is independent of logical Round/capture completion. */
export const settleRecordingEgressAttempt = (
  database: TxSource,
  input: {
    readonly recordingId: string;
    readonly generation: number;
    readonly egressId: string | null;
    readonly observation:
      | { readonly kind: 'complete' }
      | { readonly kind: 'failed'; readonly id: string }
      | { readonly kind: 'not-dispatched' };
  },
) =>
  inTransaction(database, async (tx) => {
    const [own] = await tx
      .select()
      .from(captures)
      .where(eq(captures.recordingId, input.recordingId))
      .for('update');
    if (
      !own ||
      own.egressGeneration !== input.generation ||
      own.egressId !== input.egressId
    )
      return false;
    if (input.observation.kind !== 'not-dispatched' && own.egressId === null)
      return false;
    if (
      input.observation.kind === 'failed' &&
      input.observation.id !== own.egressId
    )
      return false;
    if (
      input.observation.kind === 'not-dispatched' &&
      (own.egressDispatchedAt !== null || own.egressId !== null)
    )
      return false;
    // A dispatched job without a known identity remains unresolved, including after every deadline.
    if (own.egressDispatchedAt !== null && own.egressId === null) return false;
    const now = await readDatabaseTime(tx);
    const rows = await tx
      .update(captures)
      .set({ egressSettledAt: now })
      .where(
        and(
          eq(captures.recordingId, input.recordingId),
          isNull(captures.egressSettledAt),
        ),
      )
      .returning({ id: captures.recordingId });
    return rows.length === 1 || own.egressSettledAt !== null;
  });
