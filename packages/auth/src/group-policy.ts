import type { SocialCreationPolicy } from './authorization-facts';
import { betaDmPolicy } from './social-policy';
import { socialMemberReading, type SocialReadingInput } from './social-reading';

/** Invite-only staging groups; admission checks every prospective contact pair. */
export const stagingGroupPolicy = {
  state: 'approved',
  decision: 'Group chat staging release',
  key: 'social.private_group',
  revision: 1,
  earlierRevisions: [],
  groupBlockScope: 'all_pairs',
} as const satisfies SocialCreationPolicy;

/** Web and realtime select the same pinned membership/history rule. */
export const messagingMemberReading = (groups: boolean) => {
  const dm = socialMemberReading(betaDmPolicy);
  const group = socialMemberReading(stagingGroupPolicy);
  return (input: SocialReadingInput) =>
    groups && input.channel.authority.kind === 'private_group'
      ? group(input)
      : dm(input);
};
