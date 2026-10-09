import { createAppError } from '@daisy/errors';
import {
  authorize,
  type AuthorizationInput,
  type AuthorizationPrincipal,
} from './authorization';
import type { Identity } from './identity';
export type AuthorizationProjection = Pick<
  AuthorizationInput,
  'resource' | 'context'
>;
/** Pure mapper; producer row ancestry remains in the projection, never request flags. */
export function toAuthorizationInput(
  projection: AuthorizationProjection,
  principal: AuthorizationPrincipal,
  capability: AuthorizationInput['capability'],
): AuthorizationInput {
  return { ...projection, principal, capability };
}
/** Uniform public masking; reason may be sent only to a registered scoped log sink. */
export function requireAuthorization(input: AuthorizationInput): void {
  if (authorize(input).allow) return;
  const read = [
    'room.read',
    'room.list',
    'channel.read',
    'channel.subscribe',
    'channel.request.read',
    'foundation.read',
  ].includes(input.capability);
  throw createAppError(
    read
      ? 'NOT_FOUND'
      : input.principal.kind === 'anonymous'
        ? 'AUTHENTICATION'
        : 'AUTHORIZATION',
  );
}
/** Unavailable identity refuses before any resource loader/content query. */
export async function authorizeRequest({
  identity,
  capability,
  load,
}: {
  readonly identity: Identity;
  readonly capability: AuthorizationInput['capability'];
  readonly load: (
    principal: AuthorizationPrincipal,
  ) => Promise<AuthorizationProjection | null>;
}) {
  if (identity.state === 'unavailable') throw createAppError('INFRASTRUCTURE');
  const projection = await load(identity.principal);
  if (!projection) throw createAppError('NOT_FOUND');
  const input = toAuthorizationInput(
    projection,
    identity.principal,
    capability,
  );
  requireAuthorization(input);
  return input;
}
/** Inbox identity is separate from any Room/channel entitlement. */
export function authorizeInbox(
  principal: AuthorizationPrincipal,
  inboxActorId: string,
  account: AuthorizationInput['context']['account'],
) {
  return (
    principal.kind === 'user' &&
    principal.actorId !== null &&
    principal.actorId === inboxActorId &&
    account?.userId === principal.userId &&
    account.actorId === principal.actorId &&
    account.member &&
    !account.erased
  );
}
