import type {
  ChannelAuthorizationFact,
  SocialAccountFact,
} from './authorization-facts';
import { policyEvidenceCurrent } from './authorization-policy';
import {
  socialPolicyEvidence,
  type SocialContactPolicy,
} from './social-policy';

/**
 * Membership, not participant admission: facts about the other accounts in
 * a channel use `member` (ADR 0075), so one account losing admission never
 * closes reading for the rest.
 */
function currentBoundMember({ account }: SocialAccountFact) {
  return (
    account.actorId !== null &&
    account.member &&
    !account.erased &&
    Number.isSafeInteger(account.revision) &&
    account.revision > 0
  );
}

export type SocialReadingInput = {
  readonly channel: ChannelAuthorizationFact;
  readonly accounts: readonly SocialAccountFact[];
  readonly now: string;
};

/**
 * Channel members only: evidence that every current member may read a
 * channel minted under `policy`'s key and revision. Consumers must still
 * call canonical authorize with freshly fenced facts; this grants neither
 * membership nor content access.
 */
export const socialMemberReading =
  (policy: SocialContactPolicy) =>
  ({ channel, accounts, now }: SocialReadingInput) => {
    const evidence = socialPolicyEvidence(channel, accounts, now);
    const allowed =
      policy.state === 'approved' &&
      `social.${channel.authority.kind}` === policy.key &&
      channel.policyKey === policy.key &&
      channel.policyRevision === policy.revision &&
      accounts.every(currentBoundMember) &&
      policyEvidenceCurrent(
        channel,
        { ...evidence, allowed: true },
        {
          account: accounts[0]?.account ?? null,
          socialAccounts: accounts,
          now,
        },
      );
    return { ...evidence, allowed };
  };
