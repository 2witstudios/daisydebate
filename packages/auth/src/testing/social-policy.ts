import type { SocialCreationPolicy } from '../authorization-facts';
import type { SocialContactPolicy } from '../social-policy';
import { socialMemberReading } from '../social-reading';

/** Explicit isolated-fixture policy; never a runtime default or product approval. */
export const messagingTestPosting = {
  state: 'approved',
  decision: 'isolated browser fixture only',
  key: 'social.dm',
  revision: 1,
  allowedBandPairs: [['adult', 'adult']],
} as const satisfies SocialContactPolicy;

/** Selected only by isolated group browser tests; DEC127 stays unapproved. */
export const messagingTestGroupPolicy = {
  ...messagingTestPosting,
  key: 'social.private_group',
  groupBlockScope: 'all_pairs',
} as const satisfies SocialCreationPolicy;

export const messagingTestReading = socialMemberReading(messagingTestPosting);
export const messagingTestGroupReading = socialMemberReading(
  messagingTestGroupPolicy,
);
