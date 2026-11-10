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

/**
 * The judge's reading of the stage: a heading naming where the Round is and
 * one sentence on who has the floor and what comes next. Steps that run on
 * their own say so, because a judge has no control that starts them.
 */
export function judgeRoomStageOf(
  observed: ObservedRound,
  facts: {
    /** How many resolutions were drawn for the strike; null when unknown. */
    readonly drawSize: number | null;
    /** What the server says the Round waits on once the speeches end. */
    readonly waitingOn: RoundWaitingOn['state'] | null;
  },
): JudgeRoomStage {
  const { drawSize } = facts;
  const now = observed.speeches.findIndex((speech) => speech.state === 'now');
  const speech = observed.speeches[now];
  switch (observed.stage) {
    case 'strike':
      return {
        key: 'strike',
        heading: 'The debaters are choosing the resolution',
        detail: `They take turns striking ${drawSize === null ? 'the drawn resolutions' : `${drawSize} drawn resolutions`} until one is left. You see the resolution once it is chosen.`,
      };
    case 'opening-prep':
      return {
        key: 'opening-prep',
        heading: 'Prep before the round',
        detail: `Both debaters are preparing. ${firstSpeech(observed)} starts on its own when prep ends.`,
      };
    case 'starting':
      return {
        key: 'starting',
        heading: 'The round is about to start',
        detail: `${firstSpeech(observed)} starts on its own.`,
      };
    case 'countdown':
      return {
        key: 'countdown',
        heading: 'Starting',
        detail: `${firstSpeech(observed)} starts when the countdown ends.`,
      };
    case 'speech': {
      const side = sideDoing(observed, 'speaking') ?? speech?.side ?? null;
      return {
        key: `speech-${now}`,
        heading: speech ? speechName(speech) : 'Speech',
        detail: `${side ? `${seatName(observed.seats, side)} is speaking. ` : ''}${nextOf(observed)}`,
      };
    }
    case 'cross-ex': {
      const asks = sideDoing(observed, 'asking');
      return {
        key: `cross-ex-${now}`,
        heading: speech ? speechName(speech) : 'Cross-examination',
        detail: `${asks ? `${seatName(observed.seats, asks)} asks; ${seatName(observed.seats, other(asks))} answers. ` : ''}${nextOf(observed)}`,
      };
    }
    case 'prep': {
      const side = sideDoing(observed, 'preparing');
      return {
        key: `prep-${observed.speeches.findIndex((s) => s.state === 'next')}-${side ?? ''}`,
        heading: side ? `${sideName[side]} prep` : 'Prep',
        detail: `${side ? `${seatName(observed.seats, side)} is using prep time. ` : ''}${nextOf(observed)}`,
      };
    }
    case 'between':
      return {
        key: `between-${observed.speeches.findIndex((s) => s.state === 'next')}`,
        heading: 'Between speeches',
        detail: observed.speeches.some((s) => s.state === 'next')
          ? nextOf(observed)
          : 'Waiting on the round.',
      };
    case 'judging':
      return {
        key: 'judging',
        heading: 'The speeches are over',
        detail: ballotDetail[facts.waitingOn ?? 'settling'] ?? ballotOpen,
      };
  }
}
