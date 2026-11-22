import { instantMs } from '@daisy/clock';
import { subscriptionAccess } from '@daisy/auth/authorization';
import type {
  ClubInvitationResendFacts,
  ClubSeatManagerCommand,
  Database,
} from '@daisy/db';
import {
  clubInvitationMailRefusal,
  type SeatInvitation,
} from '@daisy/protocol/club-seats';
import type { MemberCaller } from '../../server/member-boundary';

/** A lapsed plan offers no seat worth mailing; earlier refusals win. */
export function clubInvitationResendRefusal(input: {
  readonly active: boolean;
  readonly invitation: SeatInvitation | null;
  readonly now: string;
}) {
  if (!input.active) return 'no-active-plan';
  if (!input.invitation) return 'invitation-not-found';
  return instantMs(input.invitation.expiresAt) <= instantMs(input.now)
    ? 'invitation-expired'
    : null;
}

/** Other manager commands keep their own existing store operation. */
export function createClubSeatCommands(
  store: ReturnType<Database['clubSeats']>,
) {
  return {
    answer: store.answer,
    command(
      subject: MemberCaller,
      organizationId: string,
      command:
        | ClubSeatManagerCommand
        | { readonly kind: 'resend'; readonly invitationId: string },
    ) {
      if (command.kind !== 'resend')
        return store.command(subject, organizationId, command);
      return store.resend(
        subject,
        organizationId,
        command.invitationId,
        async (facts: ClubInvitationResendFacts, mail) => {
          const reason = clubInvitationResendRefusal({
            active:
              facts.evidence !== null &&
              subscriptionAccess(facts.evidence, facts.now).kind !== 'none',
            invitation: facts.invitation,
            now: facts.now,
          });
          if (reason) return reason;
          return clubInvitationMailRefusal(await mail(), facts.seatCount);
        },
      );
    },
  };
}
