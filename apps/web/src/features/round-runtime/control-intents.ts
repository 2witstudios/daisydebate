import {
  roundControlsAt,
  type RoundCommandOption,
} from '@daisy/debate-engine/position';
import { instantMs } from '@daisy/clock';
import { isDebatingSeat } from '@daisy/protocol/seats';
import { isNamedSeat, type RoundView } from '@daisy/protocol/round-view';
import { isRoundRunning } from '@daisy/protocol/round';
import { type RoundCommand, type RoundPosition } from '@daisy/protocol/runtime';
import { type RoundCommandEnvelope } from '@daisy/protocol/round-command';
import { formatCountdown } from '../../lib/clock-display';
import { speechInSentence, startSpeechLabel } from '../debate-room/vocabulary';

export type RoundControlIntent = {
  /** Unique among one seat's controls: the type, and the offer an accept takes. */
  readonly key: string;
  readonly type: RoundCommandEnvelope['command']['type'];
  /** The command exactly as it posts, with the segment it names (INTX-7). */
  readonly command: RoundCommand;
  readonly label: string;
  readonly participantId?: string;
  readonly enabled: boolean;
  readonly confirm?: boolean;
  /** One line under the button: what it will do, or why it cannot yet. */
  readonly hint?: string;
  /** How the control stands out: the move that answers a point of information. */
  readonly emphasis?: 'primary' | 'point';
};

/** A control's key: its type, and the offer an accept takes (one button each). */
export const controlKeyOf = (
  type: string | undefined,
  offererParticipantId: string | undefined,
) =>
  type === 'accept_poi' && offererParticipantId !== undefined
    ? `accept_poi-${offererParticipantId}`
    : (type ?? '');

/** A segment by name inside a sentence ("the affirmative rebuttal"), never its code. */
const speechOf = (view: RoundView, sequence: number) => {
  const segment = view.rules.segments[sequence];
  return segment ? `the ${speechInSentence(segment.label)}` : 'the next speech';
};

const nameOf = (view: RoundView, participantId: string) =>
  view.participants.filter(isNamedSeat).find((p) => p.id === participantId)
    ?.label ?? 'their offer';

/** Why an offer cannot be made now, from the speech's own window. */
const offerHint = (
  position: RoundPosition,
  legal: boolean,
  nowMs: number,
): string | undefined => {
  const window = position.pointOfInformation;
  if (legal || window === null) return undefined;
  if (window.holder !== null) return 'A point is being given';
  const opensInMs = instantMs(window.offersOpenAt) - nowMs;
  if (opensInMs > 0) return `Opens in ${formatCountdown(opensInMs)}`;
  return 'Closed for the rest of this speech';
};

/** The words on each command; what is offered and legal is the engine's. */
const wording = (
  view: RoundView,
  option: RoundCommandOption,
  position: RoundPosition,
  nowMs: number,
  selfId: string,
): Pick<RoundControlIntent, 'label' | 'confirm' | 'hint' | 'emphasis'> => {
  const { command, legal } = option;
  switch (command.type) {
    case 'start_prep': {
      const before = speechOf(view, command.sequence);
      if (!legal)
        return {
          label: position.prepExpired ? 'Prep has ended' : 'Prep spent',
          hint: `No prep before ${before}`,
        };
      return position.openSegment
        ? {
            label: 'Call prep',
            hint: `Starts the moment ${speechOf(view, position.openSegment.sequence)} ends`,
          }
        : { label: 'Take prep time', hint: `Before ${before}` };
    }
    case 'cancel_prep':
      return {
        label: 'Cancel prep',
        hint: `Prep is called before ${speechOf(view, command.sequence)}`,
      };
    case 'start_speech': {
      const segment = view.rules.segments[command.sequence];
      return {
        label: segment ? startSpeechLabel(segment.label) : 'Start speech',
        hint: 'Ends prep; unused prep stays your side’s',
        emphasis: 'primary',
      };
    }
    case 'yield':
      return position.openSegment?.type === 'cross_ex'
        ? {
            label: 'End cross-examination',
            confirm: true,
            hint: 'Unused time is not added to prep',
          }
        : { label: 'End speech', confirm: true };
    case 'offer_poi': {
      const hint = offerHint(position, legal, nowMs);
      return {
        label: 'Offer POI',
        emphasis: 'point',
        ...(hint === undefined ? {} : { hint }),
      };
    }
    case 'withdraw_poi':
      return { label: 'Withdraw POI' };
    case 'accept_poi':
      return {
        label: `Accept ${nameOf(view, command.offererParticipantId)}`,
        emphasis: 'point',
      };
    case 'decline_poi':
      return { label: 'Decline POI' };
    case 'end_poi':
      // The holder concludes their point; the speaker takes the speech back.
      return position.pointOfInformation?.holder?.participantId === selfId
        ? { label: 'End POI', emphasis: 'primary' }
        : { label: 'Resume speech', emphasis: 'primary' };
    case 'forfeit':
      return { label: 'Forfeit round', confirm: true };
    case 'leave':
      return { label: 'Leave round', confirm: true };
  }
};

/**
 * What the engine offers this actor's debater seat now, or null: no such seat,
 * a Round that is over, or a checkpoint this view could not read (no live
 * position, so nothing can be offered).
 */
const seatControls = (view: RoundView, actorId: string, nowMs: number) => {
  const seats = view.participants.filter(isNamedSeat);
  const self = seats.find(
    (p) =>
      p.actorId === actorId && p.kind === 'human' && isDebatingSeat(p.seat),
  );
  if (!self || !isRoundRunning(view.status) || view.checkpoint === null)
    return null;
  return {
    self,
    ...roundControlsAt({
      round: view,
      rules: view.rules,
      segments: view.segments,
      checkpoint: view.checkpoint,
      nowMs,
      participants: seats,
      seat: self,
    }),
  };
};

/**
 * Whether this actor's withdrawal (a forfeit, or leaving a Round no forfeit
 * ends) would be taken now, by the engine's own rule, in the opening or the
 * debate. Leave asks this; it is the one place the question is answered.
 */
export function withdrawalLegalNow(
  view: RoundView,
  actorId: string,
  nowMs: number,
  type: 'forfeit' | 'leave',
): boolean {
  const controls = seatControls(view, actorId, nowMs);
  if (!controls) return false;
  const legal = controls.options.some(
    (option) => option.command.type === type && option.legal,
  );
  // The opening has no segment to persist; the debate posts against one.
  return view.status === 'opening'
    ? legal
    : legal && persistedPhase(view, controls.position);
}

/** The engine's options for this seat in words; a post still meets locked authority and the engine. */
export function roundControlIntents(
  view: RoundView,
  actorId: string,
  nowMs: number,
): readonly RoundControlIntent[] {
  // The opening runs on its own; its only command is the strike on its own form.
  if (view.status === 'opening') return [];
  const controls = seatControls(view, actorId, nowMs);
  if (!controls) return [];
  const { self, position, options } = controls;
  const current = persistedPhase(view, position);
  return options.map((option) => ({
    key: controlKeyOf(
      option.command.type,
      option.command.type === 'accept_poi'
        ? option.command.offererParticipantId
        : undefined,
    ),
    type: option.command.type,
    command: option.command,
    participantId: self.id,
    enabled: current && option.legal,
    ...wording(view, option, position, nowMs, self.id),
  }));
}

/**
 * Whether the server has persisted the open segment the Round's clock shows.
 * The clock may display a transition the instant it is due, but a command
 * carries the version this view observed, so acting before the server's tick
 * reaches the view is refused as stale (ISSUE-838).
 */
function persistedPhase(view: RoundView, position: RoundPosition) {
  const persisted = view.segments.find((s) => s.endedAt === null);
  return (
    (persisted?.sequence ?? null) === (position.openSegment?.sequence ?? null)
  );
}
