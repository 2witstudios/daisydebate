import type { ReadyScreen } from '../../../features/ranked/drive-match';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { AutoAdvance } from '../auto-advance/auto-advance';
import { MatchParticipants } from '../match-participants/match-participants';
import { cardTitleClass, RankedCard } from '../ranked-card/ranked-card';

/** Both accepted: the room is being made with the standard rules. */
export function MatchReady({ screen }: { readonly screen: ReadyScreen }) {
  return (
    <RankedCard>
      <AutoAdvance advance={screen.advance} />
      <div className="flex flex-col items-center gap-3 py-3 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-accent text-accent-ink">
          <Icon name="check" size={32} />
        </span>
        <h1 className={cn(cardTitleClass, 'text-2xl')}>Both ready</h1>
        <p className="text-md text-ink-muted">Opening your room.</p>
      </div>
      <MatchParticipants
        participants={[
          { name: 'You', note: 'Ready', done: true },
          { name: `@${screen.opponent.handle}`, note: 'Ready', done: true },
        ]}
      />
    </RankedCard>
  );
}
