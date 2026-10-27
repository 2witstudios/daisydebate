import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import { requireMessagingActor } from '../principal';

/**
 * The member's own choice to hide their online status from friends (ADR
 * 0072). Hidden, every friend sees them offline and no friend's badge counts
 * them; nothing tells a friend that they chose to hide.
 */
export async function setPresenceHidden(
  principal: AuthorizationPrincipal,
  hidden: boolean,
  dependencies: {
    readonly clock: Clock;
    readonly limit: (actorId: string) => Promise<void>;
    readonly write: (
      scope: { readonly userId: string; readonly actorId: string },
      input: { readonly hidden: boolean; readonly now: string },
    ) => Promise<boolean>;
  },
): Promise<{ readonly hidden: boolean }> {
  const { actorId, userId } = requireMessagingActor(principal);
  await dependencies.limit(actorId);
  return {
    hidden: await dependencies.write(
      { userId, actorId },
      { hidden, now: dependencies.clock.now() },
    ),
  };
}
