import type { Identity } from '@daisy/auth';

type AccountPrincipal = Extract<
  Extract<Identity, { principal: unknown }>['principal'],
  { kind: 'user' }
>;

/**
 * The account behind a request, admitted or not: following, reporting and
 * posting need an account, not admission. Null for a visitor.
 */
export const accountOf = (identity: Identity): AccountPrincipal | null =>
  identity.state !== 'anonymous' &&
  'principal' in identity &&
  identity.principal.kind === 'user'
    ? identity.principal
    : null;
