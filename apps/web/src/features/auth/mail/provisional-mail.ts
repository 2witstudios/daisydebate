import type { ProvisionalMailCleanup } from '@daisy/db';
import { EMAILED_LINK_PURPOSES } from '../confirmation/emailed-link-token';
import { deriveRecipientSubkey, recipientKey } from './recipient-key';

/**
 * The one description of a provisional account's mail (ISSUE-660, review on
 * #474): its sign-in and email-change link purposes, from the app's own
 * purpose list, and its keyed recipient hash. Both the held age forget and
 * the abandoned-account sweep delete with it. The subkey is derived once,
 * on first use, from the secret the auth configuration holds.
 */
export function provisionalMailCleanup(
  recipientHashSecret: () => string,
): ProvisionalMailCleanup {
  let subkey: string | undefined;
  return {
    signInPurpose: EMAILED_LINK_PURPOSES[0],
    emailChangePurposes: EMAILED_LINK_PURPOSES.filter((purpose) =>
      purpose.startsWith('email-change-'),
    ),
    recipientHashOf: (email) =>
      recipientKey(
        (subkey ??= deriveRecipientSubkey(recipientHashSecret())),
        email,
      ),
  };
}
