import { createAppError } from '@daisy/errors';
import type { RoundProjection } from '@daisy/protocol';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { eq } from 'drizzle-orm';
import { rounds } from './schema/rounds';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import {
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { sampleRoundExecutionTime } from './round-execution-time';
import { writeSpeakingProjection } from './round-speaking-writer';

type Tx = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];
export type LockedRoundTickInput = {
  readonly roundId: string;
  readonly buildProjection: (context: {
    readonly round: RoundHydration;
    readonly now: string;
  }) => RoundProjection;
};
/** Reentrant Round lock; call inside the existing bounded append/finalize transaction, never a nested transaction. */
export async function executeLockedRoundTick(
  tx: Tx,
  input: LockedRoundTickInput,
) {
  const current = await lockedRoundVersion(tx, input.roundId);
  const round = await hydrateRoundRows(tx, input.roundId);
  if (!round) throw createAppError('NOT_FOUND');
  const now = await sampleRoundExecutionTime(tx);
  let changed = false;
  if (round.status === 'active') {
    const projection = input.buildProjection({ round, now });
    changed = await writeProjectionWithPhaseSignal(
      tx,
      input.roundId,
      current,
      projection,
      now,
    );
    await writeSpeakingProjection(tx, {
      roundId: input.roundId,
      projection,
      resultingVersion: current.version + (changed ? 1 : 0),
      commandId: null,
    });
  }
  const [anchors] = await tx
    .select({
      finalSegmentEndedAt: rounds.finalSegmentEndedAt,
      transcriptAdmissionCutoff: rounds.transcriptAdmissionCutoff,
    })
    .from(rounds)
    .where(eq(rounds.id, input.roundId));
  if (!anchors) throw createAppError('NOT_FOUND');
  return {
    roundId: input.roundId,
    resultingVersion: current.version + (changed ? 1 : 0),
    now,
    finalSegmentEndedAt: anchors.finalSegmentEndedAt?.toISOString() ?? null,
    transcriptAdmissionCutoff:
      anchors.transcriptAdmissionCutoff?.toISOString() ?? null,
  };
}
