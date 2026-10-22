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

const denied = (): RoundMediaGrants => ({
  publish: [],
  subscribe: false,
  hidden: false,
  capture: false,
});

/** Fresh authoritative seats and a server-ticked position; never a browser clock or timetable. */
export function mediaGrants(input: {
  readonly participants: RoundCommandAuthority['participants'];
  readonly participantId: string;
  readonly rules: RoundRules;
  readonly position: RoundPosition;
  readonly now: string;
  readonly finalSegmentEndedAt: string | null;
}): RoundMediaGrants {
  const { position, rules } = input;
  const now = Date.parse(input.now);
  const seat = input.participants.find(
    (participant) => participant.id === input.participantId,
  );
  if (
    !seat?.eligible ||
    !Number.isFinite(now) ||
    !['scheduled', 'active'].includes(position.status)
  )
    return denied();
  if (position.awaitingBallot) {
    const finalEnd = Date.parse(input.finalSegmentEndedAt ?? '');
    if (
      !Number.isFinite(finalEnd) ||
      now < finalEnd ||
      now >= finalEnd + 30 * 60_000
    )
      return denied();
  }
  if (seat.role === 'judge')
    return { publish: [], subscribe: true, hidden: true, capture: false };
  const open = position.openSegment;
  const conversation =
    position.awaitingBallot ||
    (open === null && position.nextSegment?.sequence === 0);
  const speaking =
    open !== null &&
    now >= Date.parse(open.startedAt) &&
    now < Date.parse(open.endsAt) &&
    rules.segments[open.sequence]?.key === open.key &&
    speakingParticipants(
      rules,
      input.participants,
      open.sequence,
      open.floorParticipantId,
    ).includes(seat.id);
  const microphone = position.prep === null && (conversation || speaking);
  return {
    publish: [
      ...(seat.kind === 'human' ? ['camera' as const] : []),
      ...(microphone ? ['microphone' as const] : []),
    ],
    subscribe: true,
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
