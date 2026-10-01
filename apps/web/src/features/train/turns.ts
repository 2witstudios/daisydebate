import { formatClock } from './speech-clock';
import type { PracticeConfig, Opponent } from './practice';

export type Side = 'aff' | 'neg';

/** A random side is decided at the edge, where the coin is injected. */
export const resolveSide = (config: PracticeConfig, coin: boolean): Side =>
  config.side === 'random' ? (coin ? 'aff' : 'neg') : config.side;

export type Turn = {
  /** Position in the full debate, 1 to 5; stable when the opponent changes. */
  readonly seq: number;
  readonly side: Side;
  readonly speaker: 'you' | 'opponent';
  /** "Turn 2: Neg speech": its place in the turns this practice runs. */
  readonly name: string;
  readonly who: string;
  readonly lengthSeconds: number;
};

const order: readonly Side[] = ['aff', 'neg', 'aff', 'neg', 'aff'];
const label: Readonly<Record<Side, string>> = { aff: 'Aff', neg: 'Neg' };

/** Solo seats mean nobody answers, whichever way they were asked for. */
export const effectiveOpponent = (config: PracticeConfig): Opponent =>
  config.rules.seats === 'solo' ? 'solo' : config.opponent;

/** The turns this practice runs, for the side you speak. */
export function buildTurns(
  config: PracticeConfig,
  side: Side,
): readonly Turn[] {
  const opponent = effectiveOpponent(config);
  const lengthSeconds = config.rules.speechMinutes * 60;
  return order
    .map((turnSide, index) => ({ turnSide, seq: index + 1 }))
    .filter(({ turnSide }) => opponent !== 'solo' || turnSide === side)
    .map(({ turnSide, seq }, index) => {
      const yours = opponent === 'both' || turnSide === side;
      return {
        seq,
        side: turnSide,
        speaker: yours ? 'you' : 'opponent',
        name: `Turn ${index + 1}: ${label[turnSide]} speech`,
        who: yours ? 'You' : 'AI debater',
        lengthSeconds,
      } satisfies Turn;
    });
}

/** The turn for a requested position: the next one at or after it. */
export function turnAt(turns: readonly Turn[], seq: number): Turn | null {
  return (
    turns.find((turn) => turn.seq >= seq) ?? turns[turns.length - 1] ?? null
  );
}

export const lengthLabel = (turn: Turn): string =>
  formatClock(turn.lengthSeconds * 1000);

/** The opponent's turn at or after a position, else their last; null with none. */
export function opponentTurnAt(
  turns: readonly Turn[],
  seq: number,
): Turn | null {
  const theirs = turns.filter((turn) => turn.speaker === 'opponent');
  return (
    theirs.find((turn) => turn.seq >= seq) ?? theirs[theirs.length - 1] ?? null
  );
}
