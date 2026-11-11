import type { ChallengeList } from '@daisy/protocol';
import { initialChallengeForm } from '../../features/challenges/forms';
import { initialPersonBlock } from '../../features/contacts/block-form';
import { initialFriendForm } from '../../features/friends/forms';
import { creationIdle } from '../../features/messaging/forms/create-form';
import { initialReportForm } from '../../features/reports/form';
import { ChallengeCards } from './challenge-cards';
import { ChallengeProvider, useChallenges } from './challenge-provider';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';

const unchallenged = async () => initialChallengeForm;
const actions = {
  friend: async () => initialFriendForm(),
  sendChallenge: unchallenged,
  acceptChallenge: unchallenged,
  endChallenge: unchallenged,
  message: async () => creationIdle(''),
  report: async () => initialReportForm,
  block: async () => initialPersonBlock,
};

type Held = ReturnType<typeof useChallenges>;

function Hold({ hold }: { readonly hold: (held: Held) => void }) {
  hold(useChallenges());
  return null;
}

/** The member's challenge cards under their provider, with no realtime. */
export function CardsProbe({
  initialChallenges,
  hold,
}: {
  readonly initialChallenges: ChallengeList;
  readonly hold: (held: Held) => void;
}) {
  return (
    <ChallengeProvider
      initialChallenges={initialChallenges}
      actorId={null}
      socketUrl={null}
    >
      <Hold hold={hold} />
      <ChallengeCards actions={actions} activeRoomId={null} />
    </ChallengeProvider>
  );
}
