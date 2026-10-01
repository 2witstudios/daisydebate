import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import type { Fact } from './facts';
import { structureLabel } from './labels';
import { tournamentRoutes } from './routes';
import { roundLabels } from './schedule';
import { structures, type Structure } from './tournament';

export const wizardSteps = [
  'basics',
  'size',
  'schedule',
  'rules',
  'review',
] as const;
type WizardStep = (typeof wizardSteps)[number];

const stepLabels: Readonly<Record<WizardStep, string>> = {
  basics: 'Basics',
  size: 'Size and structure',
  schedule: 'Schedule',
  rules: 'Rules and judging',
  review: 'Review and publish',
};

/** The organizer's draft as the wizard reads it. */
export type Draft = {
  readonly name: string;
  readonly description: string;
  readonly listed: boolean;
  readonly seeding: string;
  readonly waitlist: boolean;
  /** Local date and time, as a datetime-local field holds it. */
  readonly registrationOpens: string;
  readonly registrationCloses: string;
  readonly timeZone: string;
  readonly checkIn: string;
  readonly grace: string;
  readonly rules: 'standard' | 'custom';
  readonly panel: string;
};

/** Places an organizer can choose, per structure. */
export const sizesFor = (structure: Structure): readonly number[] =>
  structure === 'single-elimination' ? [8, 16, 32, 64] : [4, 6, 8, 10, 12];

const defaultPlaces = (structure: Structure): number =>
  structure === 'single-elimination' ? 16 : 8;

export type WizardQuery = {
  readonly step: WizardStep;
  readonly structure: Structure;
  readonly places: number;
};

const schema = z.object({
  step: z.enum(wizardSteps).catch('basics'),
  structure: z.enum(structures).catch('single-elimination'),
  places: z.string().optional().catch(undefined),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the wizard's URL; a size the structure lacks becomes its default. */
export function parseWizardQuery(params: SearchParams): WizardQuery {
  const parsed = schema.parse({
    step: first(params['step']),
    structure: first(params['structure']),
    places: first(params['places']),
  });
  const asked = Number(parsed.places);
  return {
    step: parsed.step,
    structure: parsed.structure,
    places: sizesFor(parsed.structure).includes(asked)
      ? asked
      : defaultPlaces(parsed.structure),
  };
}

/** The query after choosing a structure: its default size, not the old one. */
export const withStructure = (
  query: WizardQuery,
  structure: Structure,
): WizardQuery =>
  structure === query.structure
    ? query
    : { ...query, structure, places: defaultPlaces(structure) };

/** The wizard URL for a query, carrying only the non-default values. */
export function wizardHref(query: WizardQuery): string {
  const params = new URLSearchParams();
  if (query.step !== 'basics') params.set('step', query.step);
  if (query.structure !== 'single-elimination')
    params.set('structure', query.structure);
  if (query.places !== defaultPlaces(query.structure))
    params.set('places', String(query.places));
  const search = params.toString();
  return search === ''
    ? tournamentRoutes.create
    : `${tournamentRoutes.create}?${search}`;
}

export type WizardStepMark = {
  readonly step: WizardStep;
  readonly label: string;
  readonly state: 'done' | 'current' | 'todo';
  readonly href: string;
};

export const wizardMarks = (query: WizardQuery): readonly WizardStepMark[] =>
  wizardSteps.map((step, index) => {
    const at = wizardSteps.indexOf(query.step);
    return {
      step,
      label: stepLabels[step],
      state: index < at ? 'done' : index === at ? 'current' : 'todo',
      href: wizardHref({ ...query, step }),
    };
  });

type RoundRow = {
  readonly label: string;
  /** Sample default date and time, UTC. */
  readonly date: string;
  readonly time: string;
};

export type WizardSummary = {
  readonly rounds: number;
  /** Most debates that can run at once: what round 1 needs judges for. */
  readonly debates: number;
  readonly calc: string;
  readonly judgesNote: string;
  readonly roundRows: readonly RoundRow[];
};

const sampleTimes = ['14:00', '15:30', '17:00'] as const;

/** What the chosen structure and size mean: rounds, judges, the schedule. */
export function wizardSummary(query: WizardQuery): WizardSummary {
  const labels = roundLabels(query.structure, query.places);
  const debates = Math.floor(query.places / 2);
  return {
    rounds: labels.length,
    debates,
    calc:
      query.structure === 'single-elimination'
        ? `${query.places} places: ${labels.length} rounds. If fewer enter, the top seeds get byes.`
        : `${query.places} entrants: each meets every other once, ${labels.length} rounds.`,
    judgesNote: `Round 1 can run up to ${debates} debates at once, so you need up to ${debates} judges.`,
    roundRows: labels.map((label, index) => ({
      label,
      date: index < 3 ? '2026-11-07' : '2026-11-08',
      time: sampleTimes[index % sampleTimes.length] ?? '14:00',
    })),
  };
}

/** The review step's rows, from the draft and the chosen size. */
export function reviewFacts(query: WizardQuery, draft: Draft): readonly Fact[] {
  const summary = wizardSummary(query);
  return [
    ['Name', draft.name],
    ['Structure', structureLabel(query.structure)],
    ['Places', `${query.places}, ${summary.rounds} rounds`],
    ['Registration', 'Opens 12 Oct, closes 5 Nov, 18:00 UTC'],
    [
      'Rules',
      `${draft.rules === 'standard' ? 'Standard rules' : 'Custom rules'}, unrated`,
    ],
    ['Judging', '1 judge, assigned by Daisy'],
    ['Listing', draft.listed ? 'Public' : 'Link only'],
  ];
}
