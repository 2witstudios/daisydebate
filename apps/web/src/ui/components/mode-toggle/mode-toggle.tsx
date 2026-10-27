import { cn } from '../../cn';
import { modeOptionClass, modeTrackClass } from './mode-toggle-class';

/** Which competitions a filter shows: any, ranked only or casual only. */
type CompetitionMode = 'any' | 'ranked' | 'casual';

export type ModeToggleProps = {
  readonly value: CompetitionMode;
  readonly className?: string;
};

const options: readonly { value: CompetitionMode; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'ranked', label: 'Ranked' },
  { value: 'casual', label: 'Casual' },
];

/** Any / Ranked / Casual as real radios, so the form carries the choice. */
export function ModeToggle({ value, className }: ModeToggleProps) {
  return (
    <fieldset className={cn(modeTrackClass, className)}>
      <legend className="sr-only">Rated or casual</legend>
      {options.map((option) => (
        <label key={option.value} className={modeOptionClass}>
          <input
            type="radio"
            name="mode"
            value={option.value}
            defaultChecked={value === option.value}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
