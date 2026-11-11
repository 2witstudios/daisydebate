import type { ChallengeList } from '@daisy/protocol';
import { ChallengeCards } from './challenge-cards';
import { ChallengeProvider, useChallenges } from './challenge-provider';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';

const unanswered = async () => ({});
const actions = {
  friend: async () => ({ username: '' }),
  sendChallenge: unanswered,
  acceptChallenge: unanswered,
  endChallenge: unanswered,
  message: async () => ({
    requestId: '',
    recipients: '',
    title: '',
    introduction: '',
  }),
  report: unanswered,
  block: unanswered,
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
