import type {
  Ballots,
  RoundMode,
  Debater,
  JudgeBallot,
  Side,
  Visibility,
  WatchRound,
} from '../../features/watch/round';

export const seat = (
  handle: string,
  rating: number,
  standing: Debater['standing'] = 'established',
): Debater => ({ handle, rating, standing });

export type Base = {
  readonly id: string;
  readonly title: string;
  readonly mode: RoundMode;
  readonly customRules?: boolean;
  readonly visibility?: Visibility;
  readonly aff: Debater;
  readonly neg: Debater;
  readonly judges?: readonly string[];
  readonly removedSpectators?: readonly string[];
  readonly audienceFull?: boolean;
};

export const round = (base: Base, state: WatchRound['state']): WatchRound => ({
  customRules: false,
  visibility: 'public',
  judges: ['judge-one', 'judge-two', 'judge-three'],
  removedSpectators: [],
  audienceFull: false,
  ...base,
  state,
});

export const live = (
  base: Base,
  watching: number,
  turnIndex: number,
  speechSecondsLeft = 228,
): WatchRound =>
  round(base, { status: 'live', turnIndex, speechSecondsLeft, watching });

const judgeBallot = (winner: Side): JudgeBallot => ({
  winner,
  affPoints: winner === 'aff' ? 16 : 14,
  negPoints: winner === 'neg' ? 16 : 14,
  reasons:
    '[Reasons for the decision. This judge explains which argument decided the round and how each side did on argumentation, refutation, evidence and delivery.]',
});

export const published = (
  winner: Side,
  judgesFor: number,
  judgesAgainst: number,
  ranked: boolean,
  aff: Debater,
  neg: Debater,
): Ballots => {
  const loser: Side = winner === 'aff' ? 'neg' : 'aff';
  const judges = [
    ...Array.from({ length: judgesFor }, () => judgeBallot(winner)),
    ...Array.from({ length: judgesAgainst }, () => judgeBallot(loser)),
  ];
  const change = (debater: Debater, won: boolean) =>
    ranked
      ? { from: debater.rating, to: debater.rating + (won ? 9 : -9) }
      : null;
  return {
    state: 'published',
    winner,
    judgesFor,
    judgesAgainst,
    aff: change(aff, winner === 'aff'),
    neg: change(neg, winner === 'neg'),
    judges,
  };
};

export const ended = (
  base: Base,
  ballots: Ballots,
  endedAt: string,
  minutes: number,
  availability: 'ready' | 'processing' | 'expired' = 'ready',
  keptUntil: string | null = null,
): WatchRound =>
  round(base, {
    status: 'ended',
    ballots,
    recording: {
      endedAt,
      lengthSeconds: minutes * 60,
      availability,
      keptUntil,
    },
  });
