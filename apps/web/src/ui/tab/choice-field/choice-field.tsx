import type { Choice } from '../../../features/tab/action';
import { cn } from '../../cn';
import {
  controlClass,
  fieldClass,
  helperClass,
  labelClass,
} from '../../components/form-field/form-field-class';

/** A select beside its label: as wide as its options, never the whole row. */
export const inlineSelectClass =
  'h-12 max-w-full min-w-0 rounded-md border border-border bg-surface-raised px-3 text-base text-ink';

/** A labelled select drawn from a read's choice. */
export function ChoiceField({
  id,
  choice,
  layout = 'stacked',
  hideLabel = false,
}: {
  readonly id: string;
  readonly choice: Choice;
  /** `beside` puts the label and the select on one line. */
  readonly layout?: 'stacked' | 'beside';
  readonly hideLabel?: boolean;
}) {
  return (
    <div
      className={
        layout === 'beside'
          ? 'flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1'
          : fieldClass
      }
    >
      <label htmlFor={id} className={cn(labelClass, hideLabel && 'sr-only')}>
        {choice.label}
      </label>
      <select
        id={id}
        name={id}
        defaultValue={choice.value}
        className={layout === 'beside' ? inlineSelectClass : controlClass}
        aria-describedby={choice.helper === null ? undefined : `${id}-helper`}
      >
        {choice.options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
      {choice.helper === null ? null : (
        <p id={`${id}-helper`} className={helperClass}>
          {choice.helper}
        </p>
      )}
    </div>
  );
}
