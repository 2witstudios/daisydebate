'use client';

import type { Side } from '../../../features/debates/turns';
import type { BallotDebaters } from '../../../features/judge/ballot';
import { Avatar } from '../../components/avatar/avatar';
import { Icon } from '../../components/icon/icon';
import { sideNames } from '../ballot-labels';

const sides = ['affirmative', 'negative'] as const satisfies readonly Side[];

/**
 * Who won: one choice per debater, with their avatar, name and side. A real
 * radio group named `winner`, so it posts without JavaScript; once one is
 * picked the other fades.
 */
export function WinnerChoice({
  debaters,
  winner,
  onPick,
}: {
  readonly debaters: BallotDebaters;
  readonly winner: Side | null;
  readonly onPick: (side: Side) => void;
}) {
  return (
    <fieldset className="group grid grid-cols-2 gap-3 max-narrow:grid-cols-1">
      <legend className="sr-only">Who won</legend>
      {sides.map((side) => (
        <label
          key={side}
          className="flex min-w-0 cursor-pointer items-center gap-4 rounded-lg border border-border-strong bg-surface-raised p-4 transition-colors duration-120 ease-standard group-has-checked:not-has-checked:opacity-60 hover:border-ink-muted has-checked:border-accent has-checked:bg-accent-soft has-focus-visible:border-accent"
        >
          <input
            type="radio"
            name="winner"
            value={side}
            checked={winner === side}
            onChange={() => onPick(side)}
            className="peer sr-only"
          />
          <Avatar
            name={debaters[side].name}
            src={debaters[side].avatarSrc}
            size="lg"
            nameVisible
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-md font-strong text-ink">
              {debaters[side].name}
            </span>
            <span className="text-sm text-ink-muted">{sideNames[side]}</span>
          </span>
          <span
            aria-hidden="true"
            className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border-strong text-transparent peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink"
          >
            <Icon name="check" size={14} />
          </span>
        </label>
      ))}
    </fieldset>
  );
}
