import type { Database } from '@daisy/db';
import {
  blocksPreapprovalInvitation,
  canInviteClaimedPreapproval,
  isPreapprovalClaimCurrent,
} from '@daisy/protocol/beta-preapproval';

type InvitationRead = Extract<
  Awaited<ReturnType<Database['readMailIntentDelivery']>>,
  { kind: 'beta-invitation' }
>;

/** Read each fact only after its earlier eligibility gate passes; provider I/O is separate. */
export async function readBetaInvitationDelivery(read: InvitationRead): Promise<
  | { readonly kind: 'not-owed' }
  | {
      readonly kind: 'invitation';
      readonly to: string;
      readonly sendBefore: string;
    }
> {
  const grant = await read.readGrant();
  if (!grant) return { kind: 'not-owed' };
  if (grant.claimed) {
    if (!isPreapprovalClaimCurrent(grant.claimed.identity))
      return { kind: 'not-owed' };
    const account = await read.readAccount(grant.claimed.userId);
    if (
      !account ||
      !canInviteClaimedPreapproval({ ...grant.claimed.identity, ...account })
    )
      return { kind: 'not-owed' };
  }
  for (const userId of await read.readVerifiedAccounts(grant.email)) {
    if (blocksPreapprovalInvitation(await read.readAccount(userId)))
      return { kind: 'not-owed' };
  }
  return { kind: 'invitation', to: grant.email, sendBefore: read.sendBefore };
}
