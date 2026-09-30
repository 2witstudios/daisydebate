import Link from 'next/link';
import type { ReplayView } from '../../../features/watch/replay-build';
import { cn } from '../../cn';
import { timelineStepClass } from '../spectate/spectate-class';
import { densityBarClass } from './replay-class';

export type TimelineProps = {
  readonly timeline: ReplayView['timeline'];
  readonly density: ReplayView['density'];
};

/** The phases as jump links, with the reaction density beneath them. */
export function Timeline({ timeline, density }: TimelineProps) {
  return (
    <section aria-label="Timeline" className="flex flex-col gap-2">
      <div className="flex justify-between text-sm text-ink-muted">
        <span>Phases, sample timings</span>
        <span>Press a phase to jump</span>
      </div>
      <ol className="flex gap-1">
        {timeline.steps.map((step) => (
          <li key={step.abbreviation} className="flex flex-1">
            <Link
              href={step.href}
              aria-label={`Jump to ${step.name}`}
              aria-current={step.state === 'current' ? 'step' : undefined}
              className={cn(
                timelineStepClass(step.state),
                'flex-1 no-underline hover:no-underline',
              )}
            >
              {step.abbreviation}
              <span className="font-book">{step.time}</span>
            </Link>
          </li>
        ))}
      </ol>
      <div aria-hidden="true" className="flex h-6 items-end gap-px">
        {density.map((level, index) => (
          <span key={index} className={densityBarClass(level)} />
        ))}
      </div>
      <p className="text-xs text-ink-faint">
        Reaction density: anonymous totals, no names
      </p>
    </section>
  );
}
