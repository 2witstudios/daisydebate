import { welcomeHref } from '../access/decision';

/** Whether a local path is already one of the onboarding steps. */
const isOnboardingPath = (destination: string): boolean =>
  /^\/onboarding\/[a-z]+(?:[?#]|$)/.test(destination);

/**
 * Where a member goes once the passkey offer is behind them: the
 * onboarding flow, then the destination; straight to the destination for
 * a member who already finished (or skipped) it, or whose destination is
 * itself an onboarding step (Help's link), so the flow never wraps itself.
 */
export const afterPasskeyHref = (
  destination: string,
  completedAt: string | null,
): string =>
  completedAt === null && !isOnboardingPath(destination)
    ? welcomeHref(destination)
    : destination;
