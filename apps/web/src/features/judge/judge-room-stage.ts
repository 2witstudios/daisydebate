import type { RoundWaitingOn } from '@daisy/protocol/round-view';
import type { SeatRef } from '@daisy/protocol/seats';
import { formatCountdown } from '../../lib/clock-display';
import type {
  ObservedRound,
  ObservedSeat,
  ObservedSpeech,
} from '../round-runtime/observed-round';
import { sameTeam } from '../round-runtime/round-reading';

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

const seatName = (seat: ObservedSeat) => `${seat.label} (${seat.sideLabel})`;

/** The card of the seat a segment is scheduled to: its side's, or its own unsided. */
const cardOf = (
  observed: ObservedRound,
  lead: SeatRef | null,
): ObservedSeat | null =>
  observed.seats.find((seat) => sameTeam(seat.seat, lead)) ?? null;

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

/** Whose floor it is, from the seat doing it. */
const seatDoing = (
  observed: ObservedRound,
  activity: ObservedSeat['activity'],
): ObservedSeat | null =>
  observed.seats.find((seat) => seat.activity === activity) ?? null;

/** Every seat doing it, by name: "Sam (Affirmative) and Kai (Negative)". */
const seatsDoing = (
  observed: ObservedRound,
  activity: ObservedSeat['activity'],
): string =>
  observed.seats
    .filter((seat) => seat.activity === activity)
    .map(seatName)
    .join(' and ');

/** Where the ballot stands once the speeches end, for every state the server reports. */
const ballotDetail: Readonly<Record<RoundWaitingOn['state'], string>> = {
  closing_transcript:
    'Your ballot opens in a moment, once the transcript is saved.',
  awaiting_attendance:
    'Fill in your ballot now. Submitting opens once attendance for the last speeches is confirmed.',
  human_window:
    'Ballots are open until the judging window closes. Submit yours if you have not yet.',
  held_by_writer: 'The result is being settled.',
  settling: 'The result is being settled.',
  ai_processing: 'The result is being settled.',
  ai_failed: 'The result is being settled.',
  ai_recovering: 'The result is being settled.',
  ai_blocked: 'The result is being settled.',
};

/** Whether the judge may still have a ballot to fill in: before the result settles. */
export const judgeBallotDue = (state: RoundWaitingOn['state'] | null) =>
  state === null ||
  state === 'closing_transcript' ||
  state === 'awaiting_attendance' ||
  state === 'human_window';

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
const lead = (seat: ObservedSeat | null, says: (name: string) => string) =>
  seat ? says(seatName(seat)) : '';

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
  countdown: (observed) => {
    const next = indexOf(observed, 'next');
    const speech = observed.speeches[next];
    return {
      key: `countdown-${next}`,
      heading: next <= 0 ? 'Starting' : 'Between speeches',
      detail: `${speech ? speechName(speech) : firstSpeech(observed)} starts when the countdown ends.`,
    };
  },
  speech: (observed) => {
    const speech = nowSpeech(observed);
    const seat =
      seatDoing(observed, 'speaking') ?? cardOf(observed, speech?.lead ?? null);
    return {
      key: `speech-${indexOf(observed, 'now')}`,
      heading: speech ? speechName(speech) : 'Speech',
      detail: `${lead(seat, (name) => `${name} is speaking. `)}${nextOf(observed)}`,
    };
  },
  'cross-ex': (observed) => {
    const speech = nowSpeech(observed);
    const asks = seatDoing(observed, 'asking');
    return {
      key: `cross-ex-${indexOf(observed, 'now')}`,
      heading: speech ? speechName(speech) : 'Cross-examination',
      detail: `${lead(asks, (name) => `${name} asks; ${seatsDoing(observed, 'answering')} answers. `)}${nextOf(observed)}`,
    };
  },
  prep: (observed) => {
    const seat = seatDoing(observed, 'preparing');
    return {
      key: `prep-${indexOf(observed, 'next')}-${seat?.side ?? ''}`,
      heading: seat ? `${seat.sideLabel} prep` : 'Prep',
      detail: `${lead(seat, (name) => `${name} is using prep time. `)}${nextOf(observed)}`,
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
    key: `judging-${waitingOn ?? 'speeches-ended'}`,
    heading: 'The speeches are over',
    detail:
      waitingOn === null
        ? 'Your ballot opens once the transcript is saved.'
        : ballotDetail[waitingOn],
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
