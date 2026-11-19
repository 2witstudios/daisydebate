import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  tournamentJudges,
  judgeEvents,
  judgeAvailability,
} from '../schema/tournament-judges';
import { bumpTabAccountRevision } from './command-accounts';
import type { JudgeRegistrationWrite } from './judge-registration-write';
import type { Tx } from '../tx';

const one = (rows: readonly unknown[]): void => {
  if (rows.length !== 1)
    throw createAppError(
      'INVARIANT',
      'Judge registration write did not affect one row',
    );
};
const apply = async (tx: Tx, write: JudgeRegistrationWrite): Promise<void> => {
  switch (write.table) {
    case 'tournament_judges':
      if (write.op === 'insert') {
        await tx.insert(tournamentJudges).values(write.row);
        return;
      }
      return one(
        await tx
          .update(tournamentJudges)
          .set(write.set)
          .where(
            and(
              eq(tournamentJudges.id, write.where.id),
              eq(tournamentJudges.version, write.where.version),
            ),
          )
          .returning({ id: tournamentJudges.id }),
      );
    case 'judge_events':
      if (write.op === 'insert') {
        await tx.insert(judgeEvents).values(write.row);
        return;
      }
      await tx
        .delete(judgeEvents)
        .where(
          eq(judgeEvents.tournamentJudgeId, write.where.tournamentJudgeId),
        );
      return;
    case 'judge_availability':
      if (write.op === 'insert') {
        await tx.insert(judgeAvailability).values(write.row);
        return;
      }
      return one(
        await tx
          .update(judgeAvailability)
          .set(write.set)
          .where(
            and(
              eq(
                judgeAvailability.tournamentJudgeId,
                write.where.tournamentJudgeId,
              ),
              eq(judgeAvailability.timeSlotId, write.where.timeSlotId),
            ),
          )
          .returning({ id: judgeAvailability.tournamentJudgeId }),
      );
    case 'users':
      return bumpTabAccountRevision(tx, write.id);
  }
};
export const applyJudgeRegistrationWrites = async (
  tx: Tx,
  writes: readonly JudgeRegistrationWrite[],
): Promise<void> => {
  for (const write of writes) await apply(tx, write);
};
