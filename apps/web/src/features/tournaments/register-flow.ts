import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { formatWhen } from './dates';
import { entryEligibility, type Viewer } from './entry';
import type { Fact } from './facts';
import type { TournamentView } from './get-tournament';
import { slotsLabel } from './labels';
import { tournamentRoutes } from './routes';
import { statusOf, type Tournament } from './tournament';

const registerSteps = ['eligibility', 'entry', 'review', 'done'] as const;
export type RegisterStep = (typeof registerSteps)[number];

export type RegisterQuery = {
  readonly step: RegisterStep;
  /** The two review checkboxes, as a GET form submits them ("on"). */
  readonly rules: boolean;
  readonly agree: boolean;
};

export const defaultRegisterQuery: RegisterQuery = {
  step: 'eligibility',
  rules: false,
  agree: false,
};

const checked = z
  .string()
  .transform((value) => value === 'on')
  .catch(false);

const schema = z.object({
  step: z.enum(registerSteps).catch(defaultRegisterQuery.step),
  rules: checked,
  agree: checked,
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the flow's URL state; bad or missing values become defaults. */
export const parseRegisterQuery = (params: SearchParams): RegisterQuery =>
  schema.parse({
    step: first(params['step']),
    rules: first(params['rules']),
    agree: first(params['agree']),
  });

/** The URL of a step. No form value is ever carried except the two ticks. */
export function registerHref(
  id: string,
  step: RegisterStep,
  ticks: { readonly rules: boolean; readonly agree: boolean } = {
    rules: false,
    agree: false,
  },
): string {
  const params = new URLSearchParams();
  if (step !== 'eligibility') params.set('step', step);
  if (ticks.rules) params.set('rules', 'on');
  if (ticks.agree) params.set('agree', 'on');
  const search = params.toString();
  const base = tournamentRoutes.enter(id);
  return search === '' ? base : `${base}?${search}`;
}

export type StepMark = {
  readonly label: string;
  readonly state: 'done' | 'current' | 'todo';
};

const stepLabels: Readonly<Record<RegisterStep, string>> = {
  eligibility: 'Eligibility',
  entry: 'Entry',
  review: 'Review',
  done: 'Done',
};

export type Refusal = 'closed' | 'outside-band' | 'no-profile';

export type RegisterScreen =
  | {
      readonly kind: 'refused';
      readonly reason: Refusal;
      readonly tournament: Tournament;
      readonly viewer: Viewer | null;
    }
  | {
      readonly kind: 'flow';
      readonly step: RegisterStep;
      /** The review was submitted without both boxes ticked. */
      readonly missing: boolean;
      /** Full tournament: the entry is a waitlist place. */
      readonly waitlist: boolean;
      /** The viewer's place on the waitlist once entered. */
      readonly position: number;
      readonly steps: readonly StepMark[];
      readonly tournament: Tournament;
      readonly viewer: Viewer;
      readonly summary: readonly Fact[];
      readonly ticks: { readonly rules: boolean; readonly agree: boolean };
    };

const stepMarks = (current: RegisterStep): readonly StepMark[] =>
  registerSteps.map((step, index) => {
    const at = registerSteps.indexOf(current);
    return {
      label: stepLabels[step],
      state: index < at ? 'done' : index === at ? 'current' : 'todo',
    };
  });

const summaryOf = (tournament: Tournament, viewer: Viewer): readonly Fact[] => [
  ['Starts', formatWhen(tournament.startsAt)],
  [
    'Places',
    `${slotsLabel(tournament)} places taken${tournament.waitlisted > 0 ? `, ${tournament.waitlisted} waiting` : ''}`,
  ],
  [
    'Entering as',
    `@${viewer.handle}, ${viewer.established ? 'established' : 'provisional'}`,
  ],
  ['Rating effect', 'None'],
];

/** Why the viewer cannot enter, or null. An entered viewer is never refused. */
function refusalOf(view: TournamentView): Refusal | null {
  const { tournament, viewer, entry } = view;
  if (viewer === null || !viewer.established) return 'no-profile';
  if (entry !== null) return null;
  const eligibility = entryEligibility(tournament, viewer);
  return eligibility.ok ? null : eligibility.reason;
}

/** Done needs both ticks; an entered viewer is always on Done. */
function stepFor(query: RegisterQuery, entered: boolean): RegisterStep {
  if (entered) return 'done';
  return query.step === 'done' && !(query.rules && query.agree)
    ? 'review'
    : query.step;
}

/**
 * The registration flow's one driver. It maps the URL step to a screen, and
 * is the swap point for real server state: an entered viewer lands on Done,
 * a refused one on the refusal, and Done without both ticks returns to
 * Review. Nothing here records an entry.
 */
export function registerFlow(
  view: TournamentView,
  query: RegisterQuery,
): RegisterScreen {
  const { tournament, viewer, entry } = view;
  const reason = refusalOf(view);
  if (reason !== null || viewer === null)
    return {
      kind: 'refused',
      reason: reason ?? 'no-profile',
      tournament,
      viewer,
    };
  const step = stepFor(query, entry !== null);
  return {
    kind: 'flow',
    step,
    missing: query.step === 'done' && step === 'review',
    waitlist: statusOf(tournament) === 'full' || entry?.kind === 'waitlisted',
    position:
      entry?.kind === 'waitlisted' ? entry.position : tournament.waitlisted + 1,
    steps: stepMarks(step),
    tournament,
    viewer,
    summary: summaryOf(tournament, viewer),
    ticks: { rules: query.rules, agree: query.agree },
  };
}
