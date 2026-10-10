import type { SocialContactPolicy } from '@daisy/auth/social-policy';
import { socialPolicyEvidence } from '@daisy/auth/social-policy';
import type { MessagingReadingPolicy } from '../src/features/messaging/authorization-fence';
/** Explicit isolated proof inputs, never production policy/collection activation. */
export const messagingFixturePosting: SocialContactPolicy = {
  state: 'approved',
  decision: 'Integration fixture only',
  key: 'social.dm',
  revision: 1,
  allowedBandPairs: [['adult', 'adult']],
};
export const messagingFixtureReading: MessagingReadingPolicy = (input) => ({
  ...socialPolicyEvidence(input.channel, input.accounts, input.now),
  allowed: true,
});
