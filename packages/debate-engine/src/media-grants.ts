import type {
  RoundCommandAuthority,
  RoundPosition,
  RoundRules,
} from '@daisy/protocol';
import { conversational } from '@daisy/protocol';
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
   * so a private phase's microphones and cameras wait. Speech is unaffected
   * (ADR 0099).
   */
  readonly conversationHeld?: boolean;
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
/**
 * Prep has no cameras. Any other private phase has them once nothing can carry
 * them to the audience. A public phase always has them, held or not.
 */
const cameraOpen = (input: MediaGrantInput) =>
  input.position.prep === null &&
  !(
    input.conversationHeld === true &&
    phasePrivateAt(
      broadcastPhase(input.position, input.rules.segments.length - 1),
      Date.parse(input.now),
    )
  );
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
  const microphone =
    position.prep === null &&
    ((conversational(position) && input.conversationHeld !== true) ||
      speakingNow(input));
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
