/**
 * The Foundation format's turns, in order. The real timetable is computed
 * from the rules and the database start time; this is the sample the mock
 * walks through.
 */
export type Side = 'affirmative' | 'negative';

export type Turn = {
  readonly number: number;
  readonly kind: 'prep' | 'speech';
  /** `both` for prep: neither side speaks. */
  readonly side: Side | 'both';
  readonly label: string;
  readonly seconds: number;
};

export const turns: readonly Turn[] = [
  { number: 1, kind: 'prep', side: 'both', label: 'Prep time', seconds: 120 },
  {
    number: 2,
    kind: 'speech',
    side: 'affirmative',
    label: 'Affirmative speech',
    seconds: 240,
  },
  {
    number: 3,
    kind: 'speech',
    side: 'negative',
    label: 'Negative speech',
    seconds: 240,
  },
  {
    number: 4,
    kind: 'speech',
    side: 'affirmative',
    label: 'Affirmative rebuttal',
    seconds: 120,
  },
  {
    number: 5,
    kind: 'speech',
    side: 'negative',
    label: 'Negative rebuttal',
    seconds: 120,
  },
];

/** Past the last turn: the speaking is over and the ballot is awaited. */
export const endedTurn = turns.length + 1;

/** `m:ss` for a number of seconds. */
export const formatSeconds = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Sample seconds already spent in the current turn. */
const sampleElapsed = 78;

export const remainingSeconds = (turn: Turn): number =>
  Math.max(turn.seconds - sampleElapsed, 0);
