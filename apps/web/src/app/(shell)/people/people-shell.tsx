import type { ReactNode } from 'react';
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
import { blockAction } from '../contacts/actions';
import { messagePersonAction } from '../messages/new/actions';
import { reportAction } from '../reports/actions';
import { setPeopleRail } from './actions';
import { readPeople } from './read-people';

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
  preference,
  activeRoomId,
}: {
  readonly preference: PeopleRailPreference;
  readonly activeRoomId: string | null;
}) {
  const [list, challenges] = await Promise.all([
    readPeople(),
    readChallenges().catch(() => null),
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
        />
        <PhoneChallengeCards
          actions={personActions}
          activeRoomId={activeRoomId}
        />
      </>
    ),
    wrap: (shell: ReactNode) => (
      <PeopleProvider
        initialList={list ?? empty}
        socketUrl={challenges?.socketUrl ?? null}
      >
        <ChallengeProvider
          initialChallenges={challenges?.list ?? noChallenges}
          actorId={challenges?.actorId ?? null}
          socketUrl={challenges?.socketUrl ?? null}
        >
          {shell}
        </ChallengeProvider>
      </PeopleProvider>
    ),
  };
}
