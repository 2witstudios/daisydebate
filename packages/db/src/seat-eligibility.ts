import { createAppError } from '@daisy/errors';
type ActorFact = {
  readonly kind: 'human' | 'bot';
  readonly eligible: boolean;
  /** Which seat an AI actor may hold (ISSUE-750); null for a human. */
  readonly seatRole: 'debater' | 'judge' | null;
} | null;

/**
 * ISSUE-750: a bot debater fits only a side seat and the AI judge only the
 * judge seat, whenever and however it was seated.
 */
export const aiSeatFits = (
  seatRole: 'debater' | 'judge' | null,
  role: string,
) => seatRole === (role === 'judge' ? 'judge' : 'debater');
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
  seat: { readonly actorId: string; readonly role: string },
): { readonly kind: 'human' | 'bot'; readonly eligible: boolean } {
  if (!actor) return { kind: 'human', eligible: false };
  if (actor.kind === 'bot')
    return {
      kind: 'bot',
      eligible: actor.eligible && aiSeatFits(actor.seatRole, seat.role),
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

/** Eligible debating seats; judges never check in or forfeit. */
export const eligibleCompetitorIds = (
  seats: readonly {
    readonly id: string;
    readonly role: string;
    readonly eligible: boolean;
  }[],
) =>
  seats
    .filter((seat) => seat.eligible && seat.role !== 'judge')
    .map((seat) => seat.id);

/**
 * A seat the fence did not lock appeared after the fence was read, as a launch
 * committing mid-read. Nothing was decided about this caller, so it is a
 * temporary failure and never a 409, which means authority refused (ISSUE-957).
 */
export function requireFencedSeat(
  fenced: readonly string[],
  actorId: string,
): void {
  if (!fenced.includes(actorId)) throw createAppError('INFRASTRUCTURE');
}
