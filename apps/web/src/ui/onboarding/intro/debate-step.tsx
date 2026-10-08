import Link from 'next/link';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '@daisy/db/reference-formats';
import { cn } from '../../cn';
import { NextLink, OnboardingFrame, StepFooter } from '../frame/frame';
import { heading, type IntroStepProps } from './intro';

const plainName: Record<string, string> = {
  AC: 'Case',
  NC: 'Case',
  CX: 'Q&A',
  '1AR': 'Reply',
  NR: 'Reply',
  '2AR': 'Close',
};

/** Each turn's share of the bar: as wide as it is long, in minutes. */
const grow: Record<number, string> = {
  2: 'grow-2',
  3: 'grow-3',
  5: 'grow-5',
  6: 'grow-6',
};

const minutesOf = (ms: number) => ms / 60_000;

function segmentClass(turn: IntroTurn): string {
  const affirmative = turn.side === 'affirmative';
  if (turn.kind === 'cross-examination')
    return affirmative
      ? 'border-2 border-dashed border-accent bg-accent-soft text-ink'
      : 'border-2 border-dashed border-hue-clay bg-hue-clay-soft text-ink';
  return affirmative
    ? 'bg-accent text-accent-ink'
    : 'bg-hue-clay text-surface-raised';
}

/** The schedule the intro shows: the practice room's resolved segments. */
const introRules = (() => {
  const resolved = resolveRoomConfiguration(
    oneOnOneDefinition,
    practiceRoomConfig,
  );
  if (!resolved.ok) throw new Error(resolved.refusal.message);
  return resolved.rules;
})();
const introTurns = introRules.segments.map((segment, index) => ({
  index,
  name: segment.key,
  label: segment.label,
  kind:
    segment.type === 'cross_ex'
      ? ('cross-examination' as const)
      : ('speech' as const),
  side: segment.side,
  durationMs: segment.durationMs,
}));
type IntroTurn = (typeof introTurns)[number];

const turnText = (turn: IntroTurn) =>
  `${turn.side === 'affirmative' ? 'Aff' : 'Neg'} ${
    turn.kind === 'cross-examination'
      ? 'questions'
      : (plainName[turn.name] ?? turn.label)
  } ${minutesOf(turn.durationMs)} min`;

/** Step 3: how a debate runs, drawn from the resolved schedule. */
export function DebateStep({ nextHref, backHref, skip }: IntroStepProps) {
  const speaking = introTurns.reduce(
    (sum, turn) => sum + minutesOf(turn.durationMs),
    0,
  );
  const explainers = [
    [
      'Speeches',
      "Each side opens with its case, then replies to the other's. Sides are assigned, so you argue whichever one you get.",
      '/train/rules',
      'Read the rules',
    ],
    [
      'Q&A',
      `After each opening case, the other side has ${minutesOf(
        introTurns.find((turn) => turn.kind === 'cross-examination')
          ?.durationMs ?? 0,
      )} minutes to question the speaker directly.`,
      '/watch',
      'Watch a debate',
    ],
    [
      'Decision',
      'A judge picks the side with the stronger case and writes why. In ranked debates, the result moves your rating.',
      '/leaderboard',
      'How ratings work',
    ],
  ] as const;
  return (
    <OnboardingFrame step={3} titleId="onboarding-title" skip={skip}>
      <h1 id="onboarding-title" className={heading}>
        How a debate works
      </h1>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-sunken px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-strong tracking-widest text-ink-muted uppercase">
            The motion
          </span>
          <span className="font-display text-xl text-ink">
            This house would ban homework
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-round bg-accent px-3 py-1 text-sm font-strong text-accent-ink">
            Aff argues for
          </span>
          <span className="rounded-round bg-hue-clay px-3 py-1 text-sm font-strong text-surface-raised">
            Neg argues against
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <ol
          aria-label={`Turn order: ${introTurns.map(turnText).join(', ')}`}
          className="flex h-onboarding-bar gap-1"
        >
          {introTurns.map((turn) => (
            <li
              key={turn.index}
              aria-hidden="true"
              className={cn(
                'flex min-w-0 basis-0 items-center justify-center rounded-sm text-sm font-strong',
                grow[minutesOf(turn.durationMs)] ?? 'grow',
                segmentClass(turn),
              )}
            >
              {plainName[turn.name]}
            </li>
          ))}
        </ol>
        <div
          aria-hidden="true"
          className="flex gap-1 text-xs text-ink-muted tabular-nums"
        >
          {introTurns.map((turn) => (
            <span
              key={turn.index}
              className={cn(
                'basis-0 text-center',
                grow[minutesOf(turn.durationMs)] ?? 'grow',
              )}
            >
              {minutesOf(turn.durationMs)}
            </span>
          ))}
        </div>
        <p className="text-sm text-ink-muted">
          {`${speaking} minutes of speaking, plus ${minutesOf(introRules.inRoundPrep?.budgetMsPerSide ?? 0)} minutes of prep you can spend between turns.`}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-6 max-narrow:grid-cols-1">
        {explainers.map(([title, body, href, link]) => (
          <div key={title} className="flex flex-col gap-2">
            <span className="text-md font-strong text-ink">{title}</span>
            <span className="text-base leading-normal text-ink-muted">
              {body}
            </span>
            <Link href={href} className="text-base font-strong">
              {link}
            </Link>
          </div>
        ))}
      </div>
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}
