import type { LobbyMode } from '../../../features/lobby/query';
import { cn } from '../../cn';
import { modeOptionClass, modeTrackClass } from './mode-toggle-class';

export type ModeToggleProps = {
  readonly value: LobbyMode;
  readonly className?: string;
};

const options: readonly { value: LobbyMode; label: string }[] = [
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
