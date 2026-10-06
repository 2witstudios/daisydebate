'use client';

import { debateSides } from '@daisy/protocol';
import type { Side } from '../../../features/debates/turns';
import type { BallotDebaters } from '../../../features/judge/ballot';
import { Avatar } from '../../components/avatar/avatar';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { sideNames } from '../ballot-labels';

/** A picked card and its check fill in the side's colour. */
const picked: Readonly<Record<Side, { card: string; check: string }>> = {
  affirmative: {
    card: 'has-checked:border-accent has-checked:bg-accent-soft',
    check:
      'peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink',
  },
  negative: {
    card: 'has-checked:border-hue-clay has-checked:bg-hue-clay-soft',
    check:
      'peer-checked:border-hue-clay peer-checked:bg-hue-clay peer-checked:text-surface-raised',
  },
};

/**
 * Who won: one choice per debater, with their avatar, name and side. A real
 * radio group named `winner` that the browser owns (`defaultChecked`), so it
 * posts without JavaScript and a form reset after a refusal restores the
 * pick it was rendered with. Once one is picked the other steps back.
 */
export function WinnerChoice({
  debaters,
  initial,
  onPick,
}: {
  readonly debaters: BallotDebaters;
  /** The pick to render with: the last posted one, or none. */
  readonly initial: Side | null;
  readonly onPick: (side: Side) => void;
}) {
  return (
    <fieldset className="group grid grid-cols-2 gap-3 max-narrow:grid-cols-1">
      <legend className="sr-only">Who won</legend>
      {debateSides.map((side) => (
        <label
          key={side}
          className={cn(
            'flex min-w-0 cursor-pointer items-center gap-4 rounded-lg border border-border-strong bg-surface-raised p-4 transition-colors duration-120 ease-standard group-has-checked:not-has-checked:border-border group-has-checked:not-has-checked:bg-surface hover:border-ink-muted has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink max-narrow:gap-3 max-narrow:p-3',
            picked[side].card,
          )}
        >
          <input
            type="radio"
            name="winner"
            value={side}
            defaultChecked={initial === side}
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
            <span className="text-md font-strong break-words text-ink">
              {debaters[side].name}
            </span>
            <span className="text-sm text-ink-muted">{sideNames[side]}</span>
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border-strong text-transparent',
              picked[side].check,
            )}
          >
            <Icon name="check" size={14} />
          </span>
        </label>
      ))}
    </fieldset>
  );
}
