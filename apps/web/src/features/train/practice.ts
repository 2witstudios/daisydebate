import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { trainDestinations } from './actions';
import type { HubQuery } from './query';
import { withPlanContext } from './query';
import {
  clampPrep,
  clampSpeech,
  isStandard,
  standardRules,
  type PracticeRules,
  type Seats,
} from './rules';

const sides = ['aff', 'neg', 'random'] as const;
type SideChoice = (typeof sides)[number];

export const opponents = ['ai', 'both', 'solo'] as const;
export type Opponent = (typeof opponents)[number];

/** Sample motions, plus the writer's own. */
export const motions = [
  'Cities should fund public transit before roads.',
  'Schools should ban phones in class.',
  'Voting should be compulsory.',
] as const;
export const OWN_MOTION = 3;
export const MAX_OWN_LENGTH = 140;

export type PracticeConfig = {
  readonly side: SideChoice;
  /** Index into `motions`, or `OWN_MOTION` for the writer's own. */
  readonly motion: number;
  readonly own: string;
  readonly opponent: Opponent;
  readonly coach: boolean;
  readonly hints: boolean;
  readonly rules: PracticeRules;
};

export const defaultConfig: PracticeConfig = {
  side: 'aff',
  motion: 0,
  own: '',
  opponent: 'ai',
  coach: true,
  hints: true,
  rules: standardRules,
};

// A repeated parameter answers with its last value, so a checked radio or a
// later field overrides an earlier hidden default.
const last = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[value.length - 1];

const number = (fallback: number, clamp: (n: number) => number) =>
  z
    .string()
    .regex(/^\d{1,2}$/)
    .transform((value) => clamp(Number(value)))
    .catch(fallback);

const flag = (fallback: boolean) =>
  z
    .enum(['on', 'off'])
    .transform((value) => value === 'on')
    .catch(fallback);

const configSchema = z.object({
  side: z.enum(sides).catch(defaultConfig.side),
  motion: z
    .enum(['0', '1', '2', '3'])
    .transform(Number)
    .catch(defaultConfig.motion),
  own: z
    .string()
    .transform((value) => value.trim().slice(0, MAX_OWN_LENGTH).trim())
    .catch(defaultConfig.own),
  opponent: z.enum(opponents).catch(defaultConfig.opponent),
  coach: flag(defaultConfig.coach),
  hints: flag(defaultConfig.hints),
  speech: number(standardRules.speechMinutes, clampSpeech),
  prep: number(standardRules.prepMinutes, clampPrep),
  seats: z.enum(['both', 'solo']).catch(standardRules.seats),
});

/** Reads a practice's URL state; bad or missing values become defaults. */
export function parsePracticeConfig(params: SearchParams): PracticeConfig {
  const parsed = configSchema.parse({
    side: last(params['side']),
    motion: last(params['motion']),
    own: last(params['own']),
    opponent: last(params['opp']),
    coach: last(params['coach']),
    hints: last(params['hints']),
    speech: last(params['speech']),
    prep: last(params['prep']),
    seats: last(params['seats']),
  });
  return {
    side: parsed.side,
    motion: parsed.motion,
    own: parsed.own,
    opponent: parsed.opponent,
    coach: parsed.coach,
    hints: parsed.hints,
    rules: {
      speechMinutes: parsed.speech,
      prepMinutes: parsed.prep,
      seats: parsed.seats as Seats,
    },
  };
}

/** The motion's words; an empty own motion reads as a prompt to write one. */
export const motionText = (config: PracticeConfig): string =>
  config.motion === OWN_MOTION
    ? config.own === ''
      ? 'Your own motion'
      : config.own
    : (motions[config.motion] ?? motions[0]);

const ownParam = (config: PracticeConfig): [string, string][] =>
  config.motion === OWN_MOTION && config.own !== ''
    ? [['own', config.own]]
    : [];

const rulesParams = (rules: PracticeRules): [string, string][] => [
  ...(rules.speechMinutes !== standardRules.speechMinutes
    ? ([['speech', String(rules.speechMinutes)]] as [string, string][])
    : []),
  ...(rules.prepMinutes !== standardRules.prepMinutes
    ? ([['prep', String(rules.prepMinutes)]] as [string, string][])
    : []),
  ...(rules.seats !== standardRules.seats
    ? ([['seats', rules.seats]] as [string, string][])
    : []),
];

/** The config as URL parameters, carrying only non-default values. */
export function configParams(config: PracticeConfig): URLSearchParams {
  const entries: [string, string][] = [
    ...(config.side !== defaultConfig.side
      ? ([['side', config.side]] as [string, string][])
      : []),
    ...(config.motion !== defaultConfig.motion
      ? ([['motion', String(config.motion)]] as [string, string][])
      : []),
    ...ownParam(config),
    ...(config.opponent !== defaultConfig.opponent
      ? ([['opp', config.opponent]] as [string, string][])
      : []),
    ...(config.coach ? [] : ([['coach', 'off']] as [string, string][])),
    ...(config.hints ? [] : ([['hints', 'off']] as [string, string][])),
    ...rulesParams(config.rules),
  ];
  return new URLSearchParams(entries);
}

/** A practice URL: the route, the config, the plan context and extras. */
export function practiceHref(
  path: string,
  config: PracticeConfig,
  plan: HubQuery,
  extra: Readonly<Record<string, string>> = {},
): string {
  const params = configParams(config);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const search = params.toString();
  return withPlanContext(search === '' ? path : `${path}?${search}`, plan);
}

/** The set-up route for a config and plan. */
export const setupHref = (config: PracticeConfig, plan: HubQuery): string =>
  practiceHref(trainDestinations.practice, config, plan);

const sideLabels: Readonly<Record<SideChoice, string>> = {
  aff: 'Aff (Affirmative)',
  neg: 'Neg (Negative)',
  random: 'Random, picked at the start',
};

const opponentLabels: Readonly<Record<Opponent, string>> = {
  ai: 'AI debater (sandbox seat)',
  both: 'You, on both sides (two sandbox seats)',
  solo: 'Solo, one seat',
};

const opponentNotes: Readonly<Record<Opponent, string>> = {
  ai: 'The AI debater takes one sandbox seat. Sandbox seats are practice only.',
  both: 'Two sandbox seats are made for you. Nobody else can join.',
  solo: 'Only your seat is used. The debate runs with one participant.',
};

export type PracticeSummary = {
  readonly rows: readonly (readonly [label: string, value: string])[];
  readonly note: string;
};

/** The "Your practice" recap beside the set-up choices. */
export function practiceSummary(config: PracticeConfig): PracticeSummary {
  return {
    rows: [
      ['Your side', sideLabels[config.side]],
      ['Motion', motionText(config)],
      ['Opponent', opponentLabels[config.opponent]],
      [
        'Coaching',
        `${config.coach ? 'Coach prompts on' : 'Coach prompts off'}, ${config.hints ? 'hints on' : 'hints off'}`,
      ],
      ['Rules', isStandard(config.rules) ? 'Standard rules' : 'Custom rules'],
    ],
    note: opponentNotes[config.opponent],
  };
}
