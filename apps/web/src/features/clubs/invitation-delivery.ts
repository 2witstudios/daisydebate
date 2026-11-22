import type { Database } from '@daisy/db';

type InvitationRead = Extract<
  Awaited<ReturnType<Database['readMailIntentDelivery']>>,
  { kind: 'club-invitation' }
>;

/** Both instants are normalized UTC microseconds from the same scoped read. */
export function decideClubInvitationDelivery(read: InvitationRead) {
  if (read.closed || read.expiresAt <= read.observedAt)
    return { kind: 'not-owed' } as const;
  return {
    kind: 'club-seat-invitation',
    to: read.to,
    clubName: read.clubName,
    manager: read.manager,
    organizationId: read.organizationId,
    invitationId: read.invitationId,
    expiresAt: new Date(read.expiresAt).toISOString(),
  } as const;
}
