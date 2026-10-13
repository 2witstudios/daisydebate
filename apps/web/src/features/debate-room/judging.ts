import type { CompetitionType } from '@daisy/protocol';

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
 * What each ballot is doing while the window is open. The deciding ballot
 * is always being written here: the round completes, and the room hands
 * off to the receipt, the moment it lands (DEC-80).
 */
export function ballotLines(
  ballots: JudgingBallots,
  competition: CompetitionType,
): readonly BallotLine[] {
  const deciding: BallotLine = {
    title: ballots.judge === 'ai' ? 'AI judge’s ballot' : 'Judge’s ballot',
    status: `Writing · ${decides(competition)}`,
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

/** The judging window: 30 minutes from the last speech's close (ADR 0053). */
export const JUDGING_WINDOW_MS = 30 * 60_000;

/** The main clock while the ballots are written. */
export function judgingClockOf(
  finalCloseMs: number,
  nowMs: number,
): { readonly label: string; readonly remainingMs: number } {
  return {
    label: 'Judging window',
    remainingMs: Math.max(0, finalCloseMs + JUDGING_WINDOW_MS - nowMs),
  };
}
