import { claimedUsername, type Identity } from '@daisy/auth';

/**
 * Whether a profile offers Follow: to an account, and not to a restricted one
 * or one with no username yet, which the route would refuse.
 */
export const followOfferedTo = (
  identity: Identity,
): identity is Extract<Identity, { principal: { kind: 'user' } }> =>
  identity.state !== 'restricted' &&
  claimedUsername(identity) !== null &&
  'principal' in identity &&
  identity.principal.kind === 'user';
