import type { Identity } from '@daisy/auth';

/**
 * Whether a profile offers Follow: to an account, with Watch open, and not to a
 * restricted one, which the route would refuse.
 */
export const followOfferedTo = (
  identity: Identity,
  watchOpen: boolean,
): identity is Extract<Identity, { principal: { kind: 'user' } }> =>
  watchOpen &&
  identity.state !== 'restricted' &&
  'principal' in identity &&
  identity.principal.kind === 'user';
