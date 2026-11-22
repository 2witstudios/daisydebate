import type { Database } from '@daisy/db';
import { decideClubSeating } from '@daisy/protocol/club-seats';
import type { MemberCaller } from '../../server/member-boundary';

type Store = Pick<ReturnType<Database['clubSeats']>, 'answerCommand'>;

/** Invitation policy is evaluated on the addressed invitee's fresh fenced seating. */
export function runClubInviteeCommand(
  store: Store,
  subject: MemberCaller,
  organizationId: string,
  invitationId: string,
  answer: 'accept' | 'decline',
) {
  return store.answerCommand(
    subject,
    organizationId,
    invitationId,
    answer,
    async (session) => {
      const loaded = await session.load();
      const decision = decideClubSeating(
        loaded.before,
        answer === 'accept'
          ? {
              kind: 'accept',
              invitationId,
              userId: subject.userId,
              seatedElsewhere: loaded.elsewhere,
            }
          : { kind: 'decline', invitationId },
        loaded.now,
      );
      if (decision.kind === 'refused')
        return { kind: 'refused', reason: decision.reason };
      await loaded.apply(decision.state);
      return { kind: 'changed' };
    },
  );
}
