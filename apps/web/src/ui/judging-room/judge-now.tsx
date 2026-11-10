'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import type { JudgeRoomStage } from '../../features/judge/judge-room-stage';
import type { ObservedRound } from '../../features/round-runtime/observed-round';
import { sideName } from '../../features/round-runtime/round-reading';
import { formatCountdown } from '../../lib/clock-display';
import { RoundClock } from '../debate-room/round-clock';
import { cn } from '../cn';

const activityLabel = {
  speaking: 'Speaking',
  listening: 'Listening',
  asking: 'Asking',
  answering: 'Answering',
  preparing: 'Preparing',
  waiting: 'Waiting',
} as const;

const sideInk = {
  affirmative: 'text-hue-sky',
  negative: 'text-hue-clay',
} as const;

export const judgeNowHeadingId = 'judge-now';

/**
 * Whether a stage change should take focus: only when nothing on the page
 * holds it, so a judge reading or typing elsewhere is never moved.
 */
export const focusIsFree = (active: Element | null, body: Element | null) =>
  active === null || active === body;

/**
 * The stage the judge did not trigger moves the reading point to its heading
 * when focus is free; the first render never moves it.
 */
function useStageFocus(key: string) {
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(key);
  useEffect(() => {
    if (shown.current === key) return;
    shown.current = key;
    if (focusIsFree(document.activeElement, document.body))
      heading.current?.focus();
  }, [key]);
  return heading;
}

/**
 * Where the Round is now, for its judge: the stage by name, its clock, who
 * has the floor, each side's prep left, and what comes next. Each new stage
 * is announced once, politely.
 */
export function JudgeNow({
  observed,
  stage,
  action,
}: {
  readonly observed: ObservedRound;
  readonly stage: JudgeRoomStage;
  /** The step the judge takes at this stage, if any. */
  readonly action?: ReactNode;
}) {
  const heading = useStageFocus(stage.key);
  return (
    <section
      aria-labelledby={judgeNowHeadingId}
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-xs font-bold tracking-wide text-ink-muted uppercase">
            Now
          </p>
          <h2
            id={judgeNowHeadingId}
            ref={heading}
            tabIndex={-1}
            className="font-display text-2xl font-semibold wrap-anywhere"
          >
            {stage.heading}
          </h2>
          <p className="text-base">{stage.detail}</p>
        </div>
        {observed.clock ? (
          <RoundClock
            label={observed.clock.label}
            remainingMs={observed.clock.remainingMs}
            className="flex flex-col items-end leading-tight"
          />
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only">
        {`Now: ${stage.heading}`}
      </p>
      {observed.seats.length > 0 ? (
        <ul aria-label="Debaters" className="grid grid-cols-2 gap-3 text-sm">
          {observed.seats.map((seat) => (
            <li
              key={seat.side}
              className={cn(
                'flex flex-col rounded-lg bg-surface px-3 py-2',
                (seat.activity === 'speaking' || seat.activity === 'asking') &&
                  'outline-2 outline-accent',
              )}
            >
              <span className="font-strong wrap-anywhere">
                {seat.label}
                {seat.bot ? ' · Bot' : ''}
              </span>
              <span className={sideInk[seat.side]}>{sideName[seat.side]}</span>
              <span className="text-ink-muted">
                {activityLabel[seat.activity]}
                {observed.prepMs
                  ? ` · ${formatCountdown(observed.prepMs[seat.side])} prep left`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {action}
    </section>
  );
}
