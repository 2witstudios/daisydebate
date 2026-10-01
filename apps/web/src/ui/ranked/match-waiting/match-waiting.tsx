import type { WaitingScreen } from '../../../features/ranked/drive-match';
import { Badge } from '../../components/badge/badge';
import { cn } from '../../cn';
import { AutoAdvance } from '../auto-advance/auto-advance';
import { MatchParticipants } from '../match-participants/match-participants';
import { Countdown } from '../match-progress/countdown';
import { cardTitleClass, RankedCard } from '../ranked-card/ranked-card';

/** You accepted; waiting on the other player, under the same countdown. */
export function MatchWaiting({ screen }: { readonly screen: WaitingScreen }) {
  const { handle } = screen.opponent;
  return (
    <RankedCard>
      <AutoAdvance advance={screen.advance} />
      <div>
        <Badge tone="accent">You accepted</Badge>
      </div>
      <h1
        className={cn(cardTitleClass, 'text-2xl')}
      >{`Waiting for @${handle}`}</h1>
      <MatchParticipants
        participants={[
          { name: 'You', note: 'Accepted', done: true },
          { name: `@${handle}`, note: 'Has not accepted yet', done: false },
        ]}
      />
      <Countdown seconds={screen.respondSeconds} />
    </RankedCard>
  );
}
