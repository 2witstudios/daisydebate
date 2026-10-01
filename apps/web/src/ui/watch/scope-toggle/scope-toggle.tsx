import type { RecordingsQuery } from '../../../features/watch/recordings-query';
import { cn } from '../../cn';
import {
  modeOptionClass,
  modeTrackClass,
} from '../../lobby/mode-toggle/mode-toggle-class';

export type ScopeToggleProps = {
  readonly value: RecordingsQuery['scope'];
  readonly className?: string;
};

const options = [
  { value: 'all', label: 'Public archive' },
  { value: 'mine', label: 'My debates' },
] as const;

/** Public archive / My debates as real radios, so the form carries the choice. */
export function ScopeToggle({ value, className }: ScopeToggleProps) {
  return (
    <fieldset className={cn(modeTrackClass, className)}>
      <legend className="sr-only">Whose recordings</legend>
      {options.map((option) => (
        <label key={option.value} className={modeOptionClass}>
          <input
            type="radio"
            name="scope"
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
