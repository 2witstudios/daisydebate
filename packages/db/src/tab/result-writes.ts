import { createAppError } from '@daisy/errors';
import { resultCompetitionRecordSchema } from '@daisy/protocol/lobby/result-record';
import { results, resultEntries, resultSpeakers } from '../schema/results';
import type { ResultWrite } from './result-command';
import type { TabTransaction } from './tab-transaction';

/** Immutable result records and projections share one validated writer. */
export async function applyResultWrites(
  tx: TabTransaction,
  lobbyId: string,
  writes: readonly ResultWrite[],
) {
  for (const write of writes) {
    if (write.row.lobbyId !== lobbyId)
      throw createAppError('INVARIANT', 'Result tenant changed');
    switch (write.table) {
      case 'results':
        resultCompetitionRecordSchema.parse(write.row.competitionRecord);
        await tx.insert(results).values({
          ...write.row,
          recordedAt: new Date(write.row.recordedAt),
        });
        break;
      case 'result_entries':
        await tx.insert(resultEntries).values(write.row);
        break;
      case 'result_speakers':
        await tx.insert(resultSpeakers).values(write.row);
        break;
    }
  }
}
