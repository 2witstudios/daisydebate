import type { ReactNode } from 'react';
import type { SelfCards } from '../../../ui/people/self-card';
import type { PeopleRailPreference } from '../../../ui/layout/app-shell/rail-preference';
import { ChallengeProvider } from '../../../ui/challenges/challenge-provider';
import { PeopleProvider } from '../../../ui/people/people-provider';
import {
  PeopleRail,
  PhoneChallengeCards,
} from '../../../ui/people/people-rail';
import { friendAction } from '../friends/actions';
import {
  acceptChallengeAction,
  endChallengeAction,
  sendChallengeAction,
} from '../challenges/actions';
import { readChallenges } from '../challenges/read-challenges';
import { readNotificationShell } from '../notifications/read-shell';
import { NotificationShellProvider } from '../../../ui/notifications/notification-shell-provider';
import { MessagesUnreadProvider } from '../../../ui/messaging/messages-unread-provider';
import { blockAction } from '../contacts/actions';
import { messagePersonAction } from '../messages/new/actions';
import { reportAction } from '../reports/actions';
import { setPeopleRail } from './actions';
import { readPeople } from './read-people';
import { requestMemberDivision } from '../../../features/ratings/page-reads';

/** Every action the list's menu posts; `ui/` never imports from `app/`. */
export const personActions = {
  friend: friendAction,
  sendChallenge: sendChallengeAction,
  acceptChallenge: acceptChallengeAction,
  endChallenge: endChallengeAction,
  message: messagePersonAction,
  report: reportAction,
  block: blockAction,
};

const empty = {
  version: 1 as const,
  people: [],
  nextCursor: null,
  counts: { everyone: 0, friends: 0, online: 0 },
  self: 'online' as const,
};
const noChallenges = {
  version: 1 as const,
  incoming: [],
  outgoing: [],
  accepted: [],
};

/**
 * A member's people list for the shell (ADR 0105): read here so the first HTML
 * already holds it, and a failed read still renders the rail, empty until the
 * browser's own read lands.
 */
export async function PeopleShell({
  actorId,
  socketUrl,
  preference,
  activeRoomId,
  self,
}: {
  readonly actorId: string;
  /** Your own card, heading the rail; null when there is none to show. */
  readonly self: Promise<SelfCards | null>;
  readonly socketUrl: string | null;
  readonly preference: PeopleRailPreference;
  readonly activeRoomId: string | null;
}) {
  const [list, challenges, notifications, memberDivision, cards] =
    await Promise.all([
      readPeople(),
      readChallenges().catch(() => null),
      readNotificationShell().catch(() => null),
      // Unread is no ladder: ranked stays off until the next render.
      requestMemberDivision().catch(() => null),
      self,
    ]);
  return {
    preference,
    rail: (
      <>
        <PeopleRail
          preference={preference}
          actions={personActions}
          setRail={setPeopleRail}
          activeRoomId={activeRoomId}
          selfCard={cards?.card}
          selfMini={cards?.mini}
        />
        <PhoneChallengeCards
          actions={personActions}
          activeRoomId={activeRoomId}
        />
      </>
    ),
    // The member owns this provider tree. Optional reads only seed its data.
    wrap: (shell: ReactNode) => (
      <NotificationShellProvider
        key={actorId}
        initialShell={notifications}
        actorId={actorId}
        socketUrl={socketUrl}
      >
        <MessagesUnreadProvider actorId={actorId} socketUrl={socketUrl}>
          <PeopleProvider initialList={list ?? empty} socketUrl={socketUrl}>
            <ChallengeProvider
              initialChallenges={challenges ?? noChallenges}
              actorId={actorId}
              socketUrl={socketUrl}
              memberDivision={memberDivision}
            >
              {shell}
            </ChallengeProvider>
          </PeopleProvider>
        </MessagesUnreadProvider>
      </NotificationShellProvider>
    ),
  };
}
