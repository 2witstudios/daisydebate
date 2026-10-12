import { cn } from '../cn';
import type { Debater, RoundSnapshot } from './round';

const sideName = { aff: 'Aff', neg: 'Neg' } as const;
const sideInk = { aff: 'text-hue-sky', neg: 'text-hue-clay' } as const;
const sideDisc = { aff: 'bg-hue-sky', neg: 'bg-hue-clay' } as const;

function Tile({
  debater,
  you,
  state,
  onFloor,
}: {
  readonly debater: Debater;
  readonly you: boolean;
  readonly state: string;
  readonly onFloor: boolean;
}) {
  return (
    <li
      aria-label={you ? `${debater.name}, you` : debater.name}
      aria-current={onFloor ? 'true' : undefined}
      className={cn(
        'relative room-video-tile overflow-hidden rounded-md bg-surface-stage',
        onFloor && 'ring-2 ring-stage-accent ring-inset',
      )}
    >
      <span className="absolute inset-0 flex items-center justify-center">
        <span
          className={cn(
            'flex size-16 items-center justify-center rounded-round font-display text-xl text-background',
            sideDisc[debater.side],
          )}
        >
          {debater.initials}
        </span>
      </span>
      <span className="absolute inset-x-0 bottom-0 flex items-baseline gap-2 overflow-hidden bg-scrim/70 px-2 py-1 text-sm whitespace-nowrap text-stage-ink">
        <span className={cn('font-strong', sideInk[debater.side])}>
          {sideName[debater.side]}
        </span>
        <span className="font-strong">{you ? 'You' : debater.name}</span>
        {debater.rating === null ? null : (
          <span className="text-stage-ink-muted tabular-nums">
            {debater.rating}
          </span>
        )}
        {state ? (
          <span className="ml-auto font-strong text-stage-accent">{state}</span>
        ) : null}
      </span>
    </li>
  );
}

const floorStates: Readonly<
  Record<RoundSnapshot['phase'], { self: string; opponent: string }>
> = {
  waiting: { self: '', opponent: '' },
  'opponent-speaking': { self: '', opponent: 'Speaking' },
  'cross-ex': { self: 'Asking', opponent: 'Answering' },
  prep: { self: 'Prepping', opponent: '' },
  'own-speech': { self: 'Speaking', opponent: '' },
};

/** The two debaters side by side, sized by the room's video pane. */
export function VideoStage({ round }: { readonly round: RoundSnapshot }) {
  const states = floorStates[round.phase];
  const [left, right] =
    round.self.side === 'aff'
      ? ([round.self, round.opponent] as const)
      : ([round.opponent, round.self] as const);
  const stateOf = (debater: Debater) =>
    debater.id === round.self.id ? states.self : states.opponent;
  return (
    <ul
      aria-label="Debaters"
      className="flex justify-center gap-2 border-b border-border bg-surface-sunken p-2"
    >
      {[left, right].map((debater) => (
        <Tile
          key={debater.id}
          debater={debater}
          you={debater.id === round.self.id}
          state={stateOf(debater)}
          onFloor={['Speaking', 'Answering', 'Asking'].includes(
            stateOf(debater),
          )}
        />
      ))}
    </ul>
  );
}
