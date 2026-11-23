import { isBotDebater } from '@daisy/debate-engine';
import { createRefusal } from '@daisy/errors';
import type { SeatRef } from '@daisy/protocol/seats';

/**
 * Whether bot debates are released for one account (release flag
 * `bot-debates`). The flag wins over entitlement: a subscription, beta grant
 * or club seat never opens an unreleased bot debate. This request-scoped
 * answer refuses early; the Round freeze rechecks it atomically.
 */
export type BotDebatesReleased = (userId: string) => Promise<boolean>;

/**
 * Refuse seating a bot debater (the engine's `isBotDebater`) while bot
 * debates are not released for the acting account; an AI judge passes.
 */
export function requireBotDebateReleased(
  target: { readonly kind: 'human' | 'bot' } | null,
  seat: SeatRef,
  released: boolean,
): void {
  if (!released && target !== null && isBotDebater({ kind: target.kind, seat }))
    throw createRefusal('CONFLICT', 'bot-debates-coming-soon');
}
