import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';

/** A durable user-bound actor is required before scoped application operations. */
export function requireMessagingActor(principal: AuthorizationPrincipal) {
  if (principal.kind === 'anonymous') throw createAppError('AUTHENTICATION');
  if (principal.kind !== 'user' || principal.actorId === null)
    throw createAppError('AUTHORIZATION');
  return { userId: principal.userId, actorId: principal.actorId };
}
