import type {
  ProvisionalLinkPurposes,
  ProvisionalMailCleanup,
} from '@daisy/db';
import { EMAILED_LINK_PURPOSES } from '../confirmation/emailed-link-token';
import { deriveRecipientSubkey, recipientKey } from './recipient-key';

/**
 * The link purposes a provisional account's emailed links are stored under,
 * from the app's own purpose list: sign-in, and every email-change purpose.
 * The abandoned-account sweep needs only these.
 */
export const provisionalLinkPurposes: ProvisionalLinkPurposes = {
  signInPurpose: EMAILED_LINK_PURPOSES[0],
  emailChangePurposes: EMAILED_LINK_PURPOSES.filter((purpose) =>
    purpose.startsWith('email-change-'),
  ),
};

/**
 * The one description of a provisional account's mail (ISSUE-660, review on
 * #474) for the held age forget: its link purposes and its keyed recipient
 * hash, since that deletion also removes its delivery receipts. The subkey is derived once,
 * on first use, from the secret the auth configuration holds.
 */
export function provisionalMailCleanup(
  recipientHashSecret: () => string,
): ProvisionalMailCleanup {
  let subkey: string | undefined;
  return {
    ...provisionalLinkPurposes,
    recipientHashOf: (email) =>
      recipientKey(
        (subkey ??= deriveRecipientSubkey(recipientHashSecret())),
        email,
      ),
  };
}
