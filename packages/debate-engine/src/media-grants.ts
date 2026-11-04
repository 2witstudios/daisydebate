import type {
  RoundCommandAuthority,
  RoundPosition,
  RoundRules,
} from '@daisy/protocol';
import { conversational, roundStartPolicy } from '@daisy/protocol';
import { broadcastPhase } from './broadcast-phase';
import { mediaWindowClosed } from './media-window';
import { speakingParticipants } from './round-speaking';
import { phasePrivateAt } from './stage-capture';

export type RoundMediaGrants = {
  readonly publish: readonly ('camera' | 'microphone')[];
  readonly subscribe: boolean;
  readonly hidden: boolean;
  readonly capture: false;
};

// A judge stays hidden even when denied; a revocation must never reveal it.
const denied = (hidden = false): RoundMediaGrants => ({
  publish: [],
  subscribe: false,
  hidden,
  capture: false,
});

type MediaGrantInput = {
  readonly participants: RoundCommandAuthority['participants'];
  readonly participantId: string;
  readonly rules: RoundRules;
  readonly position: RoundPosition;
  readonly now: string;
  readonly finalSegmentEndedAt: string | null;
  /**
   * Read-only input from the Broadcast: its observer has not yet been revoked,
   * so private conversation must wait. Speech is unaffected (ADR 0099).
   * Covers a Recording's own observer as well as a Broadcast's.
   */
  readonly conversationHeld?: boolean;
  /** A Broadcast's observer alone: a private phase's cameras wait for that one. */
  readonly cameraHeld?: boolean;
  /** Pre-round prep is private: nobody publishes, and media reopens at the countdown. */
  readonly inPreRoundPrep: boolean;
};
const withinMediaWindow = (input: MediaGrantInput) => {
  if (input.position.stage !== 'awaiting_ballot') return true;
  const finalEnd = Date.parse(input.finalSegmentEndedAt ?? '');
  return (
    Number.isFinite(finalEnd) &&
    Date.parse(input.now) >= finalEnd &&
    !mediaWindowClosed(
      input.position.status,
      input.now,
      input.finalSegmentEndedAt,
    )
  );
};
const speakingNow = (input: MediaGrantInput) => {
  const open = input.position.openSegment;
  if (!open) return false;
  const now = Date.parse(input.now);
  return (
    now >= Date.parse(open.startedAt) &&
    now < Date.parse(open.endsAt) &&
    input.rules.segments[open.sequence]?.key === open.key &&
    speakingParticipants(
      input.rules,
      input.participants,
      open.sequence,
      open.floorParticipantId,
    ).includes(input.participantId)
  );
};
/** Who holds the floor of the open speech, whatever the clock says. */
const holdsTheFloor = (input: MediaGrantInput) => {
  const open = input.position.openSegment;
  return (
    open !== null &&
    input.rules.segments[open.sequence]?.key === open.key &&
    speakingParticipants(
      input.rules,
      input.participants,
      open.sequence,
      open.floorParticipantId,
    ).includes(input.participantId)
  );
};
/** Closed only while a private phase's video could still reach a Broadcast. */
const cameraOpen = (input: MediaGrantInput) =>
  !(
    input.cameraHeld === true &&
    phasePrivateAt(
      broadcastPhase(input.position, input.rules.segments.length - 1),
      Date.parse(input.now),
    )
  );
/**
 * The next human speaker, just before their clock. Their microphone opens now, so capture
 * has it when the clock starts. Only the seat's own clock tells them to speak, and only
 * speech inside the interval is ever credited.
 */
export const microphoneOpensForClock = (input: {
  readonly rules: RoundRules;
  readonly participants: RoundCommandAuthority['participants'];
  readonly participantId: string;
  readonly nextSequence: number;
}) => {
  const seat = input.participants.find(
    (participant) => participant.id === input.participantId,
  );
  return (
    seat?.kind === 'human' &&
    speakingParticipants(
      input.rules,
      input.participants,
      input.nextSequence,
      null,
    ).includes(input.participantId)
  );
};
const opensForClock = (input: MediaGrantInput) => {
  const { nextSegment: next, countdownRemainingMs: left } = input.position;
  return (
    next !== null &&
    left !== null &&
    left <= roundStartPolicy.microphoneLeadMs &&
    microphoneOpensForClock({ ...input, nextSequence: next.sequence })
  );
};
const publishSources = (
  camera: boolean,
  microphone: boolean,
): RoundMediaGrants['publish'] => [
  ...(camera ? ['camera' as const] : []),
  ...(microphone ? ['microphone' as const] : []),
];

/** Fresh authoritative seats and a server-ticked position; never a browser clock or timetable. */
export function mediaGrants(input: MediaGrantInput): RoundMediaGrants {
  const { position } = input;
  const seat = input.participants.find(
    (participant) => participant.id === input.participantId,
  );
  if (
    !seat?.eligible ||
    !Number.isFinite(Date.parse(input.now)) ||
    !['opening', 'active'].includes(position.status) ||
    !withinMediaWindow(input)
  )
    return denied(seat?.role === 'judge');
  if (seat.role === 'judge')
    return { publish: [], subscribe: true, hidden: true, capture: false };
  if (input.inPreRoundPrep)
    return {
      publish: [],
      subscribe: seat.kind === 'human',
      hidden: false,
      capture: false,
    };
  // In a platform incident the clock is stopped and only the speaker's microphone stays
  // open: the Round resumes once capture confirms it hears that track, and only speech
  // inside the reopened interval is ever credited.
  const microphone =
    position.prep === null &&
    (position.incident.phase === 'none'
      ? (conversational(position) && input.conversationHeld !== true) ||
        speakingNow(input) ||
        opensForClock(input)
      : holdsTheFloor(input));
  return {
    publish: publishSources(
      seat.kind === 'human' && cameraOpen(input),
      microphone,
    ),
    subscribe: seat.kind === 'human',
    hidden: false,
    capture: false,
  };
}

/** Permissions are sets: source ordering must not cause redundant vendor writes. */
export function changedMediaGrants<
  T extends { readonly identity: string; readonly grants: RoundMediaGrants },
>(current: readonly T[], desired: readonly T[]): readonly T[] {
  return desired.filter((next) => {
    const previous = current.find(
      (entry) => entry.identity === next.identity,
    )?.grants;
    return (
      !previous ||
      previous.subscribe !== next.grants.subscribe ||
      previous.hidden !== next.grants.hidden ||
      previous.publish.length !== next.grants.publish.length ||
      next.grants.publish.some((source) => !previous.publish.includes(source))
    );
  });
}
