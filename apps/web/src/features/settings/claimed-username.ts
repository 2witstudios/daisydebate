import type { Identity } from '@daisy/auth';

/**
 * The username an account has claimed, for its own settings. A waitlisted
 * account has claimed one too: it is waiting for beta access, not for a
 * name (ADR 0075, ISSUE-690).
 */
export const claimedUsername = (identity: Identity): string | null =>
  identity.state === 'member' || identity.state === 'waitlisted'
    ? identity.username
    : null;
