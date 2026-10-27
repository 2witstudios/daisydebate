import { competitionTypes } from '@daisy/protocol';
import { cn } from '../../cn';
import { modeOptionClass, modeTrackClass } from './mode-toggle-class';

/** Which competitions a filter shows: any, or one competition type. */
const competitionModes = ['any', ...competitionTypes] as const;
type CompetitionMode = (typeof competitionModes)[number];

const modeLabels: Readonly<Record<CompetitionMode, string>> = {
  any: 'Any',
  ranked: 'Ranked',
  casual: 'Casual',
};

export type ModeToggleProps = {
  readonly value: CompetitionMode;
  readonly className?: string;
};

const options = competitionModes.map((value) => ({
  value,
  label: modeLabels[value],
}));

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
