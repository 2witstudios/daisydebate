import type { EventCompletionFacts } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
export function completionScreenings(loaded: EventCompletionFacts) {
  return loaded.submitted.map(({ ballot, screening }) => {
    const tabRoundId =
      loaded.competition.results.find(
        (result) => result.roundId === ballot.roundId,
      )?.tabRoundId ??
      loaded.currentRounds.find((round) => round.roundId === ballot.roundId)
        ?.tabRoundId;
    if (!tabRoundId)
      throw createAppError(
        'INVARIANT',
        'A submitted ballot lost its actual fixture source',
      );
    return {
      ballotId: ballot.id,
      roundId: ballot.roundId,
      tabRoundId,
      status: screening?.status ?? ('pending' as const),
    };
  });
}
