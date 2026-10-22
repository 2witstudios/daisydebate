type ActorFact = {
  readonly kind: 'human' | 'bot';
  readonly eligible: boolean;
} | null;
type AccountFact = {
  readonly actorId: string | null;
  readonly member: boolean;
  readonly erased: boolean;
} | null;

/**
 * One rule for every Round writer: a bot seat needs its canonical profile, a
 * human seat a live member account, and an actor of unknown kind is never
 * eligible (it is reported as human so no bot authority can attach to it).
 */
export function seatEligibility(
  actor: ActorFact,
  accounts: readonly AccountFact[],
  actorId: string,
): { readonly kind: 'human' | 'bot'; readonly eligible: boolean } {
  if (!actor) return { kind: 'human', eligible: false };
  if (actor.kind === 'bot') return { kind: 'bot', eligible: actor.eligible };
  const account = accounts.find((entry) => entry?.actorId === actorId);
  return {
    kind: 'human',
    eligible: account?.member === true && !account.erased,
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
