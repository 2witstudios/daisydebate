'use client';

import type { BallotSubject } from '../../../features/judge/ballot-plan';
import { Avatar } from '../../components/avatar/avatar';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';

/** A picked card and its check fill in the side's colour, by its tone. */
const pickedTones = [
  {
    card: 'has-checked:border-accent has-checked:bg-accent-soft',
    check:
      'peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink',
  },
  {
    card: 'has-checked:border-hue-clay has-checked:bg-hue-clay-soft',
    check:
      'peer-checked:border-hue-clay peer-checked:bg-hue-clay peer-checked:text-surface-raised',
  },
  {
    card: 'has-checked:border-hue-sky has-checked:bg-hue-sky-soft',
    check:
      'peer-checked:border-hue-sky peer-checked:bg-hue-sky peer-checked:text-surface-raised',
  },
  {
    card: 'has-checked:border-hue-plum has-checked:bg-hue-plum-soft',
    check:
      'peer-checked:border-hue-plum peer-checked:bg-hue-plum peer-checked:text-surface-raised',
  },
] as const;
const picked = (tone: number) =>
  pickedTones[tone % pickedTones.length] ?? pickedTones[0];

/**
 * Who won: one choice per side, with its debaters' avatar, name and side.
 * The cards sit two to a line only where the group itself is wide enough
 * (`@ballot-sides`), whatever the viewport, and draw compact below it, so
 * a narrow column stacks them rather than wrapping a name a letter at a
 * time. A long name wraps between words and is never cut: the judge has to
 * read whom they are voting for. The side label stays whole. A real
 * radio group named `winner` that the browser owns (`defaultChecked`), so it
 * posts without JavaScript and a form reset after a refusal restores the
 * pick it was rendered with. Once one is picked the other steps back.
 */
export function WinnerChoice({
  sides,
  initial,
  onPick,
}: {
  /** The Round's sides, in declared order. */
  readonly sides: readonly BallotSubject[];
  /** The pick to render with: the last posted one, or none. */
  readonly initial: string | null;
  readonly onPick: (side: string) => void;
}) {
  return (
    <div className="@container">
      <fieldset className="group grid grid-cols-1 gap-3 @ballot-sides:grid-cols-2">
        <legend className="sr-only">Who won</legend>
        {sides.map((subject) => (
          <label
            key={subject.key}
            className={cn(
              'flex min-w-0 cursor-pointer items-center gap-4 rounded-lg border border-border-strong bg-surface-raised p-4 transition-colors duration-120 ease-standard group-has-checked:not-has-checked:border-border group-has-checked:not-has-checked:bg-surface hover:border-ink-muted has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink @max-ballot-sides:gap-3 @max-ballot-sides:p-3',
              picked(subject.tone).card,
            )}
          >
            <input
              type="radio"
              name="winner"
              value={subject.key}
              defaultChecked={initial === subject.key}
              onChange={() => onPick(subject.key)}
              className="peer sr-only"
            />
            <Avatar
              name={subject.name}
              src={subject.avatarSrc}
              size="lg"
              nameVisible
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-md font-strong text-pretty text-ink">
                {subject.name}
              </span>
              <span className="text-sm text-ink-muted">{subject.role}</span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border-strong text-transparent',
                picked(subject.tone).check,
              )}
            >
              <Icon name="check" size={14} />
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
