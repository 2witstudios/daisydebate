import type { NotificationRecipient } from './notifications';

/** Current-cast facts in the adapter's existing user/seat order. */
export type DecisionAudienceSeat = {
  readonly actorId: string;
  readonly userId: string | null;
  readonly erased: boolean;
  readonly current: boolean;
  readonly kind: string;
  readonly side: string | null;
  readonly slot: number;
  /** Position in the Round's frozen declared side list, not lexical order. */
  readonly sideOrder: number | null;
};

/** Two pure decisions at the existing policy-read and audience-read boundaries. */
export type DecisionReleasePolicy = {
  readonly release: (policy: string | null) => boolean;
  readonly audience: (
    seats: readonly DecisionAudienceSeat[],
  ) => readonly NotificationRecipient[];
};

export const shouldReleaseRoundDecision = (policy: string | null): boolean =>
  policy === 'on_finalize';

/** Every current live account, about the first seat across from it. */
export function decisionAudience(
  seats: readonly DecisionAudienceSeat[],
): readonly NotificationRecipient[] {
  const current = seats.filter((seat) => seat.current);
  const sides = current
    .filter((seat) => seat.kind === 'side')
    .sort(
      (a, b) =>
        (a.sideOrder ?? Infinity) - (b.sideOrder ?? Infinity) ||
        a.slot - b.slot,
    );
  const recipients = new Map<string, NotificationRecipient>();
  for (const seat of current) {
    if (seat.userId === null || seat.erased || recipients.has(seat.userId))
      continue;
    recipients.set(seat.userId, {
      userId: seat.userId,
      about:
        sides.find((other) => other.side !== seat.side)?.actorId ??
        seat.actorId,
    });
  }
  return [...recipients.values()];
}

export const roundDecisionReleasePolicy: DecisionReleasePolicy = {
  release: shouldReleaseRoundDecision,
  audience: decisionAudience,
};
