import {
  assertNever,
  type CompetitionType,
  type RoundWaitingOn,
} from '@daisy/protocol';

/**
 * The ballots a round is judged by. One ballot decides it: the human
 * judge's, or the AI judge's when the AI judges. `ai` is the AI's ballot
 * beside a human judge's; null while no such ballot is kept.
 */
export type JudgingBallots = {
  readonly judge: 'human' | 'ai';
  readonly ai: 'writing' | 'ready' | null;
};

/** One ballot's line in the judging window. */
export type BallotLine = {
  readonly title: string;
  readonly status: string;
  readonly ready: boolean;
};

/**
 * The ballots for a round's judge seat. The ballot store keeps one ballot
 * per judge seat (ADR 0058 §6), so no AI ballot sits beside a human
 * judge's yet.
 */
export function judgingBallotsOf(
  judge: 'human' | 'ai' | null,
): JudgingBallots | null {
  return judge === null ? null : { judge, ai: null };
}

const decides = (competition: CompetitionType) =>
  competition === 'ranked' ? 'decides the rating' : 'decides the result';

/**
 * The deciding ballot's line for what the server says the Round is waiting on.
 * AI job states never describe a human judge's ballot.
 */
const decidingStatus = (
  judge: JudgingBallots['judge'],
  state: RoundWaitingOn['state'] | null,
  competition: CompetitionType,
): string => {
  const writing = `Writing · ${decides(competition)}`;
  switch (state) {
    case 'awaiting_attendance':
      return 'Waiting on attendance';
    case 'held_by_writer':
      return 'Waiting on a check-in';
    case 'closing_transcript':
      return 'Closing the transcript';
    case 'settling':
      return 'Settling the result';
    case 'ai_failed':
      return judge === 'ai' ? 'Could not rule' : 'Settling the result';
    case 'ai_recovering':
      return judge === 'ai' ? 'Recovering the ruling' : 'Settling the result';
    case 'ai_blocked':
      return judge === 'ai'
        ? 'Ruling recovery needs attention'
        : 'Settling the result';
    case 'ai_processing':
      return judge === 'ai' ? writing : 'Settling the result';
    // A human window, and a Round not yet waiting, read as the ballot being written.
    case 'human_window':
    case null:
      return writing;
    default:
      return assertNever(state);
  }
};

/**
 * What each ballot is doing. The round completes, and the room hands off to
 * the receipt, the moment the deciding ballot lands (DEC-80).
 */
export function ballotLines(
  ballots: JudgingBallots,
  competition: CompetitionType,
  state: RoundWaitingOn['state'] | null = null,
): readonly BallotLine[] {
  const deciding: BallotLine = {
    title: ballots.judge === 'ai' ? 'AI judge’s ballot' : 'Judge’s ballot',
    status: decidingStatus(ballots.judge, state, competition),
    ready: false,
  };
  if (ballots.judge === 'ai' || ballots.ai === null) return [deciding];
  const ready = ballots.ai === 'ready';
  return [
    deciding,
    {
      title: 'AI ballot',
      status: `${ready ? 'Ready' : 'Writing'} · opens with the judge’s`,
      ready,
    },
  ];
}
