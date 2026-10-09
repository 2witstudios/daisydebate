import { authorize, type AuthorizationInput } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';

/** One shared decision, with the participant HTTP surface's concealed reads. */
export function requireMessagingAuthorization(input: AuthorizationInput): void {
  const decision = authorize(input);
  if (decision.allow) return;
  if (
    input.capability === 'channel.read' ||
    input.capability === 'channel.subscribe' ||
    input.capability === 'channel.request.read'
  )
    throw createAppError('NOT_FOUND');
  throw createAppError(
    decision.reason === 'unauthenticated' ? 'AUTHENTICATION' : 'AUTHORIZATION',
  );
}
