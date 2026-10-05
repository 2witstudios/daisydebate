import { welcomeHref } from '../access/decision';

/**
 * Where a member goes once the passkey offer is behind them: the
 * onboarding flow, then the destination; straight to the destination for
 * a member who already finished (or skipped) it.
 */
export const afterPasskeyHref = (
  destination: string,
  completedAt: string | null,
): string => (completedAt === null ? welcomeHref(destination) : destination);
