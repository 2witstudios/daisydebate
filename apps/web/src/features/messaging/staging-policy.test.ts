import { assert, setupRitewayBun, test } from 'riteway/bun';
import { stagingGroupPolicy } from '@daisy/auth/group-policy';
import { deployedMessagingPolicy, tightenMessagingPolicy } from './beta-policy';
import { requirePrivateGroups } from './private-groups';

setupRitewayBun();
test('the staging group composition shares DM budgets and retains policy when tightened', () => {
  const policy = deployedMessagingPolicy('staging');
  requirePrivateGroups(policy);
  const tighter = tightenMessagingPolicy(policy, { editWindowMs: 1 });
  assert({
    given: 'the deployed staging group composition and a tighter edit policy',
    should:
      'select real admission/posting, bounded membership, retain DM policy and preserve the group policy',
    actual: [
      policy.privateGroups,
      policy.groupPosting,
      policy.social.groupAdmission,
      policy.social.groupInvitationLimits,
      policy.posting.state === 'approved' ? policy.posting.key : null,
      policy.limits.actorSend === policy.social.abuse,
      tighter.groupPosting,
      tighter.reading === policy.reading,
    ],
    expected: [
      'enabled',
      stagingGroupPolicy,
      stagingGroupPolicy,
      { maxMembers: 50, maxPendingInvitations: 50 },
      'social.dm',
      true,
      stagingGroupPolicy,
      true,
    ],
  });
});
