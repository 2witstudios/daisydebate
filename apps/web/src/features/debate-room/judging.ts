import type { CompetitionType, RoundJudgingStatus } from '@daisy/protocol';

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

/** The deciding ballot's line for what the server says the Round is waiting on. */
const decidingStatus = (
  state: RoundJudgingStatus['state'] | null,
  competition: CompetitionType,
): { readonly status: string; readonly ready: boolean } => {
  switch (state) {
    case 'ai_failed':
      return { status: 'Could not rule', ready: false };
    case 'awaiting_attendance':
      return { status: 'Waiting on attendance', ready: false };
    case 'held_by_writer':
      return { status: 'Waiting on a check-in', ready: false };
    case 'closing_transcript':
      return { status: 'Closing the transcript', ready: false };
    default:
      return { status: `Writing · ${decides(competition)}`, ready: false };
  }
};

/**
 * What each ballot is doing. The round completes, and the room hands off to
 * the receipt, the moment the deciding ballot lands (DEC-80).
 */
export function ballotLines(
  ballots: JudgingBallots,
  competition: CompetitionType,
  state: RoundJudgingStatus['state'] | null = null,
): readonly BallotLine[] {
  const deciding: BallotLine = {
    title: ballots.judge === 'ai' ? 'AI judge’s ballot' : 'Judge’s ballot',
    ...decidingStatus(state, competition),
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

/**
 * The main clock while the ballots are written: only a human judge's window,
 * counted to the deadline the server persisted. An AI judge has no such window.
 */
export function judgingClockOf(
  status: RoundJudgingStatus | null,
  nowMs: number,
): { readonly label: string; readonly remainingMs: number } | null {
  if (status?.state !== 'human_window' || status.deadlineAt === null)
    return null;
  return {
    label: 'Judging window',
    remainingMs: Math.max(0, Date.parse(status.deadlineAt) - nowMs),
  };
}
