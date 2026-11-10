import type { DebateSide, RoundWaitingOn } from '@daisy/protocol';
import { formatCountdown } from '../../lib/clock-display';
import type {
  ObservedRound,
  ObservedSeat,
  ObservedSpeech,
} from '../round-runtime/observed-round';
import { sideName } from '../round-runtime/round-reading';

/**
 * What the judge's Now panel says at one instant. `key` changes exactly when
 * the Round moves to a new stage or speech, which is when the judge is told.
 */
export type JudgeRoomStage = {
  readonly key: string;
  readonly heading: string;
  readonly detail: string;
};

const speechName = (speech: ObservedSpeech) =>
  `${speech.key} · ${speech.label}`;

const seatName = (seats: readonly ObservedSeat[], side: DebateSide) => {
  const seat = seats.find((s) => s.side === side);
  return seat ? `${seat.label} (${sideName[side]})` : sideName[side];
};

const other = (side: DebateSide): DebateSide =>
  side === 'affirmative' ? 'negative' : 'affirmative';

const nextOf = (observed: ObservedRound) => {
  const next = observed.speeches.find((speech) => speech.state === 'next');
  return next
    ? `Next: ${speechName(next)}, ${formatCountdown(next.durationMs)}.`
    : 'This is the last speech.';
};

const firstSpeech = (observed: ObservedRound) => {
  const first = observed.speeches[0];
  return first ? `${speechName(first)}` : 'The first speech';
};

/** Whose floor it is, from the side doing it. */
const sideDoing = (
  observed: ObservedRound,
  activity: ObservedSeat['activity'],
): DebateSide | null =>
  observed.seats.find((seat) => seat.activity === activity)?.side ?? null;

const ballotOpen = 'Your ballot is open.';

/** Where the ballot stands once the speeches end; any state not listed reads as open. */
const ballotDetail: Partial<Record<RoundWaitingOn['state'], string>> = {
  closing_transcript:
    'Your ballot opens in a moment, once the transcript is saved.',
  awaiting_attendance:
    'Fill in your ballot now. Submitting opens once attendance for the last speeches is confirmed.',
  human_window:
    'Your ballot is open. Submit it before the judging window closes.',
};

type StageFacts = {
  /** How many resolutions were drawn for the strike; null when unknown. */
  readonly drawSize: number | null;
  /** What the server says the Round waits on once the speeches end. */
  readonly waitingOn: RoundWaitingOn['state'] | null;
};

const indexOf = (observed: ObservedRound, state: 'now' | 'next') =>
  observed.speeches.findIndex((speech) => speech.state === state);

const nowSpeech = (observed: ObservedRound) =>
  observed.speeches[indexOf(observed, 'now')];

/** Leads a sentence with who does it, when that is known. */
const lead = (
  observed: ObservedRound,
  side: DebateSide | null,
  says: (name: string) => string,
) => (side ? says(seatName(observed.seats, side)) : '');

const stages: Readonly<
  Record<
    ObservedRound['stage'],
    (observed: ObservedRound, facts: StageFacts) => JudgeRoomStage
  >
> = {
  strike: (_, { drawSize }) => ({
    key: 'strike',
    heading: 'The debaters are choosing the resolution',
    detail: `They take turns striking ${drawSize === null ? 'the drawn resolutions' : `${drawSize} drawn resolutions`} until one is left. You see the resolution once it is chosen.`,
  }),
  'opening-prep': (observed) => ({
    key: 'opening-prep',
    heading: 'Prep before the round',
    detail: `Both debaters are preparing. ${firstSpeech(observed)} starts on its own when prep ends.`,
  }),
  starting: (observed) => ({
    key: 'starting',
    heading: 'The round is about to start',
    detail: `${firstSpeech(observed)} starts on its own.`,
  }),
  countdown: (observed) => ({
    key: 'countdown',
    heading: 'Starting',
    detail: `${firstSpeech(observed)} starts when the countdown ends.`,
  }),
  speech: (observed) => {
    const speech = nowSpeech(observed);
    const side = sideDoing(observed, 'speaking') ?? speech?.side ?? null;
    return {
      key: `speech-${indexOf(observed, 'now')}`,
      heading: speech ? speechName(speech) : 'Speech',
      detail: `${lead(observed, side, (name) => `${name} is speaking. `)}${nextOf(observed)}`,
    };
  },
  'cross-ex': (observed) => {
    const speech = nowSpeech(observed);
    const asks = sideDoing(observed, 'asking');
    return {
      key: `cross-ex-${indexOf(observed, 'now')}`,
      heading: speech ? speechName(speech) : 'Cross-examination',
      detail: `${lead(observed, asks, (name) => `${name} asks; ${seatName(observed.seats, other(asks ?? 'affirmative'))} answers. `)}${nextOf(observed)}`,
    };
  },
  prep: (observed) => {
    const side = sideDoing(observed, 'preparing');
    return {
      key: `prep-${indexOf(observed, 'next')}-${side ?? ''}`,
      heading: side ? `${sideName[side]} prep` : 'Prep',
      detail: `${lead(observed, side, (name) => `${name} is using prep time. `)}${nextOf(observed)}`,
    };
  },
  between: (observed) => ({
    key: `between-${indexOf(observed, 'next')}`,
    heading: 'Between speeches',
    detail:
      indexOf(observed, 'next') >= 0
        ? nextOf(observed)
        : 'Waiting on the round.',
  }),
  judging: (_, { waitingOn }) => ({
    key: 'judging',
    heading: 'The speeches are over',
    detail: (waitingOn && ballotDetail[waitingOn]) ?? ballotOpen,
  }),
};

/**
 * The judge's reading of the stage: a heading naming where the Round is and
 * one sentence on who has the floor and what comes next. Steps that run on
 * their own say so, because a judge has no control that starts them.
 */
export const judgeRoomStageOf = (
  observed: ObservedRound,
  facts: StageFacts,
): JudgeRoomStage => stages[observed.stage](observed, facts);
