import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type { ChosenStatus } from '@daisy/protocol';
import { requireMemberActor } from '../access/actor';

/** The member's own status choice (ADR 0103): Online, Busy or Appear offline. */
export async function setChosenStatus(
  principal: AuthorizationPrincipal,
  status: ChosenStatus,
  dependencies: {
    readonly clock: Clock;
    readonly limit: (actorId: string) => Promise<void>;
    readonly write: (
      scope: { readonly userId: string; readonly actorId: string },
      input: { readonly status: ChosenStatus; readonly now: string },
    ) => Promise<ChosenStatus>;
  },
): Promise<{ readonly status: ChosenStatus }> {
  const { actorId, userId } = requireMemberActor(principal);
  await dependencies.limit(actorId);
  return {
    status: await dependencies.write(
      { userId, actorId },
      { status, now: dependencies.clock.now() },
    ),
  };
}

/** The member's own chosen status, read behind their own decision. */
export async function readChosen(
  principal: AuthorizationPrincipal,
  dependencies: {
    readonly read: (scope: {
      readonly userId: string;
      readonly actorId: string;
    }) => Promise<ChosenStatus>;
  },
): Promise<{ readonly status: ChosenStatus }> {
  const { actorId, userId } = requireMemberActor(principal);
  return { status: await dependencies.read({ userId, actorId }) };
}
