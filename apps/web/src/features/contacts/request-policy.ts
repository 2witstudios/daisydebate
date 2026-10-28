import type { ContactsPolicyOverride } from '@daisy/config';
import type { SocialRequestLimits } from '@daisy/db';
import { tightenOnly } from '../../server/tighten-only';
import type { RateRule } from '../../server/rate-limit';

/**
 * Contacts' budgets every deployed app runs (DEC-251): the social request
 * budget, and the windows a member's contact changes (blocks) spend.
 */
export type ContactsPolicy = {
  readonly requests: SocialRequestLimits;
  readonly blocks: readonly RateRule[];
};

const DAY_MS = 86_400_000;

/**
 * DEC-251's social request budget, owned by Contacts because it counts DM and
 * friend requests together: one frozen value that is both the shipped policy
 * and the floor any override is checked against.
 */
export const dec251ContactsPolicy: ContactsPolicy = Object.freeze({
  requests: Object.freeze({
    daily: 20,
    unrelatedHourly: 5,
    declinesToBlock: 3,
    declineBlockMs: 30 * DAY_MS,
  }),
  // Contacts' own block budget, set at DEC-251's send windows; it tightens
  // through CONTACTS_POLICY, never with Messaging's send policy.
  blocks: Object.freeze([
    { max: 10, windowSeconds: 10 },
    { max: 30, windowSeconds: 60 },
    { max: 600, windowSeconds: 3_600 },
  ]),
});

const { atMost, atLeast, windows } = tightenOnly('CONTACTS_POLICY');

/**
 * The policy an app runs: `policy` with the deployment's overrides. Each may
 * only tighten; a looser value refuses the whole policy at boot, naming its
 * field, and is never clamped.
 */
export function tightenContactsPolicy(
  policy: ContactsPolicy,
  override: ContactsPolicyOverride | undefined,
): ContactsPolicy {
  if (override === undefined) return policy;
  const floor = policy.requests,
    next = override.requests ?? {};
  return Object.freeze({
    blocks: Object.freeze(windows('blocks', policy.blocks, override.blocks)),
    requests: Object.freeze({
      daily: atMost('requests.daily', floor.daily, next.daily),
      unrelatedHourly: atMost(
        'requests.unrelatedHourly',
        floor.unrelatedHourly,
        next.unrelatedHourly,
      ),
      declinesToBlock: atMost(
        'requests.declinesToBlock',
        floor.declinesToBlock,
        next.declinesToBlock,
      ),
      declineBlockMs: atLeast(
        'requests.declineBlockMs',
        floor.declineBlockMs,
        next.declineBlockMs,
      ),
    }),
  });
}
