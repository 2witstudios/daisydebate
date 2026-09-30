import type { StepMark } from '../../../features/tournaments/register-flow';
import { cn } from '../../cn';

const dot: Readonly<Record<StepMark['state'], string>> = {
  done: 'border-accent bg-accent text-accent-ink',
  current: 'border-accent bg-accent-soft text-accent',
  todo: 'border-border-strong text-ink-faint',
};

/** The numbered steps of a flow; the current one is marked for assistive tech. */
export function Stepper({
  label,
  steps,
}: {
  readonly label: string;
  readonly steps: readonly StepMark[];
}) {
  return (
    <ol
      aria-label={label}
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      {steps.map((step, index) => (
        <li
          key={step.label}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className="flex items-center gap-2"
        >
          <span
            className={cn(
              'inline-flex size-6 items-center justify-center rounded-round border text-xs font-bold',
              dot[step.state],
            )}
            aria-hidden="true"
          >
            {step.state === 'done' ? '✓' : index + 1}
          </span>
          <span
            className={cn(
              'text-sm font-strong',
              step.state === 'current' ? 'text-ink' : 'text-ink-muted',
            )}
          >
            {step.label}
          </span>
          <span className="sr-only">
            {step.state === 'done'
              ? ', done'
              : step.state === 'current'
                ? ', current step'
                : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}
