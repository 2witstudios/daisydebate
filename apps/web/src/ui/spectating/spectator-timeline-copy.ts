import {
  sideOfSeat,
  type SeatRef,
  type SpectatorTimeline,
} from '@daisy/protocol';
import { sideName } from '../../features/debate-room/seat-names';

type Sides = SpectatorTimeline['sides'];

/**
 * A released seat by name: its side's, or for an unsided seat its number among
 * the timeline's seats of that kind.
 */
export const seatLabelIn = (
  timeline: Pick<SpectatorTimeline, 'sides' | 'seats'>,
  seat: SeatRef,
): string => {
  const side = sideOfSeat(seat);
  if (side !== null) return sideName(timeline.sides, side);
  const sameKind = timeline.seats.filter(
    (entry) => entry.seat.kind === seat.kind,
  ).length;
  const name = seat.kind === 'speaker' ? 'Speaker' : 'Moderator';
  return sameKind > 1 ? `${name} ${seat.slot + 1}` : name;
};

type SlateMoment = Extract<
  SpectatorTimeline['stage'],
  { kind: 'slate' }
>['moment'];

/**
 * What the slate in the video says, as far as released facts can tell. Preparation
 * shares the between-speeches line: prep leaves no released fact of its own.
 */
const slateSentences: Readonly<Record<SlateMoment, string>> = {
  unreleased: 'Nothing is on stage right now.',
  before_first_speech: 'The first speech is still to come.',
  between_speeches: 'Preparation or a break: the next speech is coming.',
  speeches_over: 'The speeches are over. The result comes next.',
};

/**
 * The fact burned into the video at this point, in words a screen reader can
 * say. It holds no clock: it is announced whenever it changes, and a running
 * clock would announce every read.
 */
export const stageSentence = (
  timeline: Pick<SpectatorTimeline, 'sides' | 'seats'>,
  stage: SpectatorTimeline['stage'],
): string => {
  switch (stage.kind) {
    case 'upcoming':
      return 'This Round hasn’t started.';
    case 'slate':
      return slateSentences[stage.moment];
    case 'ended':
      return 'This Round has ended.';
    case 'floor': {
      if (stage.lead === null) return `${stage.label}: the floor is open.`;
      const lead = seatLabelIn(timeline, stage.lead);
      switch (stage.segment) {
        case 'cross_ex':
          return `Cross-examination: ${lead} asks.`;
        case 'speech':
        case 'open':
          return `${stage.label}: ${lead} has the floor.`;
      }
    }
  }
};

export const resultSentence = (
  sides: Sides,
  outcome: NonNullable<SpectatorTimeline['result']>['outcome'],
): string => {
  if (outcome === null) return 'No side won this Round.';
  switch (outcome.kind) {
    case 'winner':
      return `${sideName(sides, outcome.side)} won.`;
    case 'ranking':
      return outcome.of === 'sides'
        ? `Ranked: ${outcome.places
            .map((place) =>
              place.map((key) => sideName(sides, key)).join(' and '),
            )
            .join(', then ')}.`
        : 'The speakers were ranked.';
  }
};
