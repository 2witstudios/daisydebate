import {
  isRoundCompleted,
  postRoundCallPolicy,
  type MediaRoomRead,
  type PostRoundCallFacts,
  type PostRoundCallState,
} from '@daisy/protocol';
import type { RoundMediaGrants } from './media-grants';

/**
 * The one decision (ADR 0127). Only a completed Round whose host chose the
 * call has one; it ends at its cap from the Round's end, or once its room has
 * stood empty for the grace. Before the session holds the call's room the
 * call is opening: the Round's room must first be proven gone.
 */
export const postRoundCallState = (
  facts: PostRoundCallFacts,
  now: string,
): PostRoundCallState => {
  if (
    !facts.optedIn ||
    !facts.sessionOpen ||
    !isRoundCompleted(facts.status) ||
    facts.roundEndedAt === null
  )
    return { kind: 'none' };
  const nowMs = Date.parse(now);
  const endsAtMs = Date.parse(facts.roundEndedAt) + postRoundCallPolicy.maxMs;
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(endsAtMs) ||
    nowMs >= endsAtMs
  )
    return { kind: 'over' };
  if (facts.openedAt === null) return { kind: 'opening', endsAtMs };
  if (
    facts.vacantSince !== null &&
    nowMs - Date.parse(facts.vacantSince) >= postRoundCallPolicy.vacantGraceMs
  )
    return { kind: 'over' };
  return { kind: 'open', endsAtMs };
};

/**
 * Everyone human on the call may be seen and heard, the judge included; a bot
 * or a seat that lost its place gets nothing. A judge joins a fresh room
 * visible, so no hidden participant is ever revealed in place.
 */
export const postRoundCallGrants = (
  seat: { readonly kind: string; readonly eligible: boolean } | undefined,
): RoundMediaGrants =>
  seat?.kind === 'human' && seat.eligible
    ? {
        publish: ['camera', 'microphone'],
        subscribe: true,
        hidden: false,
        capture: false,
      }
    : { publish: [], subscribe: false, hidden: false, capture: false };

/**
 * Since when the call's room has stood empty, after one pass's read. A pass
 * that read nothing changes nothing; an absent room is an empty one, because
 * the vendor closes a room everyone has left.
 */
export const nextRoomVacancy = (
  current: string | null,
  seen: MediaRoomRead | null,
  now: string,
): string | null => {
  if (seen === null) return current;
  if (seen.kind === 'read' && !seen.empty) return null;
  return current ?? now;
};
