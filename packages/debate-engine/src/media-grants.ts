import type {
  RoundCommandAuthority,
  RoundPosition,
  RoundRules,
} from '@daisy/protocol';
import { speakingParticipants } from './round-speaking';

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
};
const withinJudgingWindow = (input: MediaGrantInput) => {
  if (!input.position.awaitingBallot) return true;
  const finalEnd = Date.parse(input.finalSegmentEndedAt ?? '');
  const now = Date.parse(input.now);
  return (
    Number.isFinite(finalEnd) && now >= finalEnd && now < finalEnd + 30 * 60_000
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
const publishSources = (
  human: boolean,
  microphone: boolean,
): RoundMediaGrants['publish'] => [
  ...(human ? ['camera' as const] : []),
  ...(microphone ? ['microphone' as const] : []),
];
const conversational = (position: RoundPosition) =>
  position.awaitingBallot ||
  (position.openSegment === null && position.nextSegment?.sequence === 0);

/** Fresh authoritative seats and a server-ticked position; never a browser clock or timetable. */
export function mediaGrants(input: MediaGrantInput): RoundMediaGrants {
  const { position } = input;
  const seat = input.participants.find(
    (participant) => participant.id === input.participantId,
  );
  if (
    !seat?.eligible ||
    !Number.isFinite(Date.parse(input.now)) ||
    !['scheduled', 'active'].includes(position.status) ||
    !withinJudgingWindow(input)
  )
    return denied(seat?.role === 'judge');
  if (seat.role === 'judge')
    return { publish: [], subscribe: true, hidden: true, capture: false };
  const microphone =
    position.prep === null && (conversational(position) || speakingNow(input));
  return {
    publish: publishSources(seat.kind === 'human', microphone),
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
