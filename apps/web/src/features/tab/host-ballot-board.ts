import type { BallotWrittenRecord, RoundBallotRead } from '@daisy/protocol';
import { ballotPlanFor } from '../judge/ballot-plan';
import { commandAction } from './action';
import type { CompletionContext } from './completion-form';

export function hostBallotBoard(
  view: RoundBallotRead | null,
  review: {
    readonly roundId: string;
    readonly lobbyId: string;
    readonly eventId: string;
    readonly handle: string;
    readonly nextId: () => string;
  } | null,
) {
  return {
    plan: view?.judging ? ballotPlanFor(view.round, view.judging.ballot) : null,
    ballots:
      view?.ballots.map((entry) => {
        if (!review || entry.review?.screening !== 'held')
          return { entry, action: null };
        const written: BallotWrittenRecord = {
          ...(entry.ballot.reason === undefined
            ? {}
            : { reason: entry.ballot.reason }),
          ...(entry.ballot.feedback === undefined
            ? {}
            : { feedback: entry.ballot.feedback }),
        };
        return {
          entry,
          action: commandAction<{
            readonly written: BallotWrittenRecord;
            readonly context: CompletionContext;
          }>('Approve reviewed text', {
            written,
            context: {
              commandId: review.nextId(),
              lobbyId: review.lobbyId,
              eventId: review.eventId,
              handle: review.handle,
              target: {
                type: 'resolve-screening-hold',
                ballotId: entry.review.ballotId,
                roundId: review.roundId,
                feedbackKeys: Object.keys(written.feedback ?? {}),
              },
            },
          }),
        };
      }) ?? [],
  };
}
