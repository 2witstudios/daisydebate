import { aiRoleFits, type AiRole } from '@daisy/protocol/ai-roles';
import { type SeatRef } from '@daisy/protocol/seats';

type ActorFact = {
  readonly kind: 'human' | 'bot';
  readonly eligible: boolean;
  /** Which AI the actor is (ISSUE-750); null for a human. */
  readonly aiRole: AiRole | null;
} | null;

/**
 * ISSUE-750: a bot debater fits only a competitor's seat (a side's or an
 * unsided speaker's) and the AI judge only a judge seat, whenever and however
 * it was seated.
 */
export const aiSeatFits = (aiRole: AiRole | null, seat: SeatRef) =>
  aiRoleFits(aiRole, seat);
type AccountFact = {
  readonly actorId: string | null;
  readonly member: boolean;
  readonly erased: boolean;
} | null;

/** A human seat needs a live member account. */
export const humanSeatEligible = (
  accounts: readonly AccountFact[],
  actorId: string,
) => {
  const account = accounts.find((entry) => entry?.actorId === actorId);
  return account?.member === true && !account.erased;
};

/**
 * One rule for every Round writer: a bot seat needs its canonical profile
 * for that kind of seat, a human seat a live member account, and an actor of
 * unknown kind is never eligible (it is reported as human so no bot
 * authority can attach to it).
 */
export function seatEligibility(
  actor: ActorFact,
  accounts: readonly AccountFact[],
  seat: { readonly actorId: string; readonly seat: SeatRef },
): { readonly kind: 'human' | 'bot'; readonly eligible: boolean } {
  if (!actor) return { kind: 'human', eligible: false };
  if (actor.kind === 'bot')
    return {
      kind: 'bot',
      eligible: actor.eligible && aiSeatFits(actor.aiRole, seat.seat),
    };
  return {
    kind: 'human',
    eligible: humanSeatEligible(accounts, seat.actorId),
  };
}

/**
 * The distinct actors a Round write fences, seats first, in a stable order.
 * Absent optional actors are skipped.
 */
export const fencedActorIds = (
  seats: readonly { readonly actorId: string }[],
  ...extra: readonly (string | null | undefined)[]
): string[] => [
  ...new Set([
    ...seats.map((seat) => seat.actorId),
    ...extra.filter((id): id is string => !!id),
  ]),
];
