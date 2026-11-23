import { createRefusal } from '@daisy/errors';
import { isDebatingSeat, type SeatRef } from '@daisy/protocol/seats';

/**
 * Whether bot debates are released for one account (release flag
 * `bot-debates`). The flag wins over entitlement: a subscription, beta grant
 * or club seat never opens an unreleased bot debate. This request-scoped
 * answer refuses early; the Round freeze rechecks it atomically.
 */
export type BotDebatesReleased = (userId: string) => Promise<boolean>;

/** A bot in a debating seat is a bot debate; an AI judge never is. */
export const seatsBotDebater = (
  target: { readonly kind: 'human' | 'bot' } | null,
  seat: SeatRef,
): boolean => target?.kind === 'bot' && isDebatingSeat(seat);

/** Refuse seating a bot debater while bot debates are not released for the acting account. */
export function requireBotDebateReleased(
  target: { readonly kind: 'human' | 'bot' } | null,
  seat: SeatRef,
  released: boolean,
): void {
  if (!released && seatsBotDebater(target, seat))
    throw createRefusal('CONFLICT', 'bot-debates-coming-soon');
}
