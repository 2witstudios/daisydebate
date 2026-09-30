import type {
  Ballots,
  DebateMode,
  Debater,
  JudgeBallot,
  Side,
  Visibility,
  WatchDebate,
} from '../../features/watch/debate';

export const seat = (
  handle: string,
  rating: number,
  standing: Debater['standing'] = 'established',
): Debater => ({ handle, rating, standing });

export type Base = {
  readonly id: string;
  readonly title: string;
  readonly mode: DebateMode;
  readonly customRules?: boolean;
  readonly visibility?: Visibility;
  readonly aff: Debater;
  readonly neg: Debater;
  readonly judges?: readonly string[];
  readonly removedSpectators?: readonly string[];
  readonly audienceFull?: boolean;
};

export const debate = (
  base: Base,
  state: WatchDebate['state'],
): WatchDebate => ({
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
): WatchDebate =>
  debate(base, { status: 'live', turnIndex, speechSecondsLeft, watching });

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
  rated: boolean,
  aff: Debater,
  neg: Debater,
): Ballots => {
  const loser: Side = winner === 'aff' ? 'neg' : 'aff';
  const judges = [
    ...Array.from({ length: judgesFor }, () => judgeBallot(winner)),
    ...Array.from({ length: judgesAgainst }, () => judgeBallot(loser)),
  ];
  const change = (debater: Debater, won: boolean) =>
    rated
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
): WatchDebate =>
  debate(base, {
    status: 'ended',
    ballots,
    recording: {
      endedAt,
      lengthSeconds: minutes * 60,
      availability,
      keptUntil,
    },
  });
