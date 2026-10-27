import { participantAccess } from '@daisy/auth/authorization';

/**
 * ADR 0075: a realtime session counts only while it is live and its
 * account holds participant access (approved, with a durable age record at
 * the floor). Every session read, ticket redemption included, asks this.
 */
export function liveParticipantSession(
  session: {
    readonly expiresAt: string;
    readonly account: Parameters<typeof participantAccess>[0];
  } | null,
  now: string,
): boolean {
  return (
    session !== null &&
    participantAccess(session.account) &&
    Date.parse(session.expiresAt) > Date.parse(now)
  );
}
