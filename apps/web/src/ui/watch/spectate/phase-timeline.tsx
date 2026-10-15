import type { SpectateView } from '../../../features/watch/spectate-view';
import { timelineStepClass } from './spectate-class';

export type PhaseTimelineProps = {
  readonly timeline: SpectateView['timeline'];
};

/** The speech order with the current step marked; timings are samples. */
export function PhaseTimeline({ timeline }: PhaseTimelineProps) {
  return (
    <section aria-label="Phase timeline" className="flex flex-col gap-2">
      <ol className="flex gap-1">
        {timeline.steps.map((step) => (
          <li
            key={step.abbreviation}
            aria-label={step.label}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className={timelineStepClass(step.state)}
          >
            {step.state === 'current'
              ? `${step.abbreviation} · now`
              : step.abbreviation}
          </li>
        ))}
      </ol>
      <p className="text-sm text-ink-muted">{timeline.caption}</p>
    </section>
  );
}
