import type { Database } from '@daisy/db';

type ApprovalRead = Extract<
  Awaited<ReturnType<Database['readMailIntentDelivery']>>,
  { kind: 'beta-approved' }
>;

/** Missing identity takes precedence over whether the approval is still owed. */
export function decideApprovalDelivery(
  recipient: ApprovalRead['recipient'],
):
  | { readonly kind: 'recipient-gone' }
  | { readonly kind: 'not-owed' }
  | {
      readonly kind: 'member';
      readonly to: string;
      readonly username: string;
    } {
  if (!recipient?.email || !recipient.username)
    return { kind: 'recipient-gone' };
  if (recipient.state !== 'approved') return { kind: 'not-owed' };
  return { kind: 'member', to: recipient.email, username: recipient.username };
}
