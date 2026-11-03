import type { ReactNode } from 'react';
import type { OnlineRailPreference } from '../../../ui/layout/app-shell/rail-preference';
import { ChallengeProvider } from '../../../ui/challenges/challenge-provider';
import { OnlineProvider } from '../../../ui/online/online-provider';
import {
  OnlineRail,
  PhoneChallengeCards,
} from '../../../ui/online/online-rail';
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
import { setOnlineRail } from './actions';
import { readOnline } from './read-online';

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
  members: [],
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
 * A member's online list for the shell (ADR 0103): read here so the first HTML
 * already holds it, and a failed read still renders the rail, empty until the
 * browser's own read lands.
 */
export async function OnlineShell({
  preference,
  activeRoomId,
}: {
  readonly preference: OnlineRailPreference;
  readonly activeRoomId: string | null;
}) {
  const [roster, challenges] = await Promise.all([
    readOnline(),
    readChallenges().catch(() => null),
  ]);
  return {
    preference,
    rail: (
      <>
        <OnlineRail
          preference={preference}
          actions={personActions}
          setRail={setOnlineRail}
          activeRoomId={activeRoomId}
        />
        <PhoneChallengeCards
          actions={personActions}
          activeRoomId={activeRoomId}
        />
      </>
    ),
    wrap: (shell: ReactNode) => (
      <OnlineProvider
        initialRoster={roster ?? empty}
        socketUrl={challenges?.socketUrl ?? null}
      >
        <ChallengeProvider
          initialChallenges={challenges?.list ?? noChallenges}
          actorId={challenges?.actorId ?? null}
          socketUrl={challenges?.socketUrl ?? null}
        >
          {shell}
        </ChallengeProvider>
      </OnlineProvider>
    ),
  };
}
