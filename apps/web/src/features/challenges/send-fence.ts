import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { rankedAgeAdmitted } from '@daisy/auth/age-floor';
import type { ContactAuthorizationFence } from '@daisy/db/contacts';
import { createRefusal } from '@daisy/errors';
import type { CompetitionType } from '@daisy/protocol';
import { contactPairFence } from '../contacts/authorization';

/**
 * The fence a challenge offer is sent under: the pair's send capability, and
 * for a ranked offer the sender's own age, read on the locked account
 * (decision 79). The other member's age is never a reason the sender hears:
 * their Accept opens the ranked Room, which refuses them on their own age.
 */
export function challengeSendFence({
  principal,
  mode,
}: {
  readonly principal: AuthorizationPrincipal;
  readonly mode: CompetitionType;
}): ContactAuthorizationFence {
  const pair = contactPairFence({
    principal,
    capability: 'social.challenge.send',
  });
  return async (tx, input, facts) => {
    await pair(tx, input, facts);
    const sender = facts.accounts.find((row) => row?.actorId === input.actorId);
    if (mode === 'ranked' && !rankedAgeAdmitted(sender?.ageBand ?? null))
      throw createRefusal('CONFLICT', 'ranked-age');
  };
}
