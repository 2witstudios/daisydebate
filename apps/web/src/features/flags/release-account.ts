import type { Identity } from '@daisy/auth';

/**
 * The account a page reads release flags for: a member's own, so an
 * account override (an owner preview, a pilot host) applies to them; nobody
 * else's, so a visitor or an account not yet a member reads the default.
 * /pricing and the guides both read their releases this way.
 */
export const releaseAccountOf = (identity: Identity): string | null =>
  identity.state === 'member' ? identity.principal.userId : null;
