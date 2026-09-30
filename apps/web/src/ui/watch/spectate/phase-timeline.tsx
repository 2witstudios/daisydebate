import type { SpectateView } from '../../../features/watch/spectate-view';
import { timelineStepClass } from './spectate-class';

export type PhaseTimelineProps = {
  readonly timeline: SpectateView['timeline'];
};

/** The speech order with the current step marked; timings are samples. */
export function PhaseTimeline({ timeline }: PhaseTimelineProps) {
  return (
    <section aria-label="Phase timeline" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
        <span>Phase timeline · sample timings</span>
        <span>{timeline.caption}</span>
      </div>
      <ol className="flex gap-1">
        {timeline.steps.map((step) => (
          <li
            key={step.abbreviation}
            aria-label={step.label}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className={timelineStepClass(step.state)}
          >
            {step.abbreviation}
          </li>
        ))}
      </ol>
    </section>
  );
}
