import { createAppError } from '@daisy/errors';
import { idSchema, type RoundProjection } from '@daisy/protocol';
import { eq } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import {
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { sampleRoundExecutionTime } from './round-execution-time';
import { writeSpeakingProjection } from './round-speaking-writer';
import { rounds } from './schema/rounds';

/** A speech's start gate moves with the Round, in one commit, under the Round's lock. */
export function createRoundStartGateStore(deps: {
  readonly run: BoundedTransaction;
}) {
  return {
    /** An ordinary report's unlocked read: most reports change nothing. */
    readRoundStartGate: (roundId: string) =>
      deps.run(async (tx) => {
        const [row] = await tx
          .select({ checkpoint: rounds.runtimeState })
          .from(rounds)
          .where(eq(rounds.id, roundId));
        return row?.checkpoint.start_gate ?? null;
      }),
    moveRoundStartGate(input: {
      readonly roundId: string;
      readonly step: (round: RoundHydration, now: string) => RoundProjection;
    }) {
      if (!idSchema.safeParse(input.roundId).success)
        throw createAppError('VALIDATION');
      return deps.run(async (tx) => {
        const current = await lockedRoundVersion(tx, input.roundId);
        const round = await hydrateRoundRows(tx, input.roundId);
        if (!round) throw createAppError('NOT_FOUND');
        if (round.status !== 'active') return;
        const now = await sampleRoundExecutionTime(tx);
        const projection = input.step(round, now);
        const changed = await writeProjectionWithPhaseSignal(
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
      });
    },
  };
}
