import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { trainDestinations } from './actions';
import { defaultConfig, practiceHref } from './practice';
import { parseHubQuery, withPlanContext, type HubQuery } from './query';
import {
  clampPrep,
  clampSpeech,
  describeDifferences,
  isStandard,
  prepRange,
  rankedRefusal,
  speechRange,
  type PracticeRules,
  type Seats,
} from './rules';

export const MAX_NAME_LENGTH = 40;

/**
 * The custom-rules page's URL state. Every choice is in the URL, including
 * whether the set was "saved" and whether ranked was asked for: steps of the
 * mock flow until a rule-set store exists.
 */
export type CustomRulesQuery = {
  readonly rules: PracticeRules;
  readonly name: string;
  readonly saved: boolean;
  readonly ranked: boolean;
  readonly plan: HubQuery;
};

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

const minutes = (fallback: number, clamp: (n: number) => number) =>
  z
    .string()
    .regex(/^\d{1,2}$/)
    .transform((value) => clamp(Number(value)))
    .catch(fallback);

/** The sample rule set the page opens on. */
const sampleName = 'Longer speeches';
const sampleSpeech = 7;
const sampleRules: PracticeRules = {
  speechMinutes: sampleSpeech,
  prepMinutes: 4,
  seats: 'both',
};

/** Reads the page's URL state; bad or missing values become the sample. */
export function parseCustomRulesQuery(params: SearchParams): CustomRulesQuery {
  const name = z
    .string()
    .transform((value) => value.trim().slice(0, MAX_NAME_LENGTH).trim())
    .catch(sampleName)
    .parse(first(params['name']) ?? sampleName);
  return {
    rules: {
      speechMinutes: minutes(sampleRules.speechMinutes, clampSpeech).parse(
        first(params['speech']),
      ),
      prepMinutes: minutes(sampleRules.prepMinutes, clampPrep).parse(
        first(params['prep']),
      ),
      seats: z
        .enum(['both', 'solo'])
        .catch(sampleRules.seats)
        .parse(first(params['seats'])) as Seats,
    },
    name: name === '' ? sampleName : name,
    saved: first(params['saved']) === '1',
    ranked: first(params['ranked']) === '1',
    plan: parseHubQuery(params),
  };
}

/** The page's URL for a query; every rule is written so none is a default. */
export function customRulesHref(
  query: CustomRulesQuery,
  change: Partial<Pick<CustomRulesQuery, 'saved' | 'ranked'>> & {
    readonly rules?: PracticeRules;
  } = {},
): string {
  const rules = change.rules ?? query.rules;
  const params = new URLSearchParams({
    speech: String(rules.speechMinutes),
    prep: String(rules.prepMinutes),
    seats: rules.seats,
    name: query.name,
  });
  if (change.saved ?? false) params.set('saved', '1');
  if (change.ranked ?? false) params.set('ranked', '1');
  return withPlanContext(
    `${trainDestinations.customRules}?${params.toString()}`,
    query.plan,
  );
}

type Stepper = {
  readonly label: string;
  readonly hint: string;
  readonly minutes: number;
  /** Null at the end of the range: the control is then inert. */
  readonly shorterHref: string | null;
  readonly longerHref: string | null;
};

export type CustomRulesView = {
  readonly name: string;
  readonly custom: boolean;
  readonly differences: readonly string[];
  readonly steppers: readonly [Stepper, Stepper];
  readonly seats: readonly {
    readonly label: string;
    readonly href: string;
    readonly selected: boolean;
  }[];
  readonly saved: boolean;
  readonly ranked: { readonly reasons: readonly string[] } | null;
  readonly practiceHref: string;
  readonly askRankedHref: string;
  readonly closeRankedHref: string;
  readonly backHref: string;
};

const step = (
  query: CustomRulesQuery,
  key: 'speechMinutes' | 'prepMinutes',
  range: { readonly min: number; readonly max: number },
  label: string,
  hint: string,
): Stepper => {
  const value = query.rules[key];
  const to = (next: number) =>
    customRulesHref(query, { rules: { ...query.rules, [key]: next } });
  return {
    label,
    hint,
    minutes: value,
    shorterHref: value > range.min ? to(value - 1) : null,
    longerHref: value < range.max ? to(value + 1) : null,
  };
};

/** The custom-rules screen for a query. */
export function customRulesView(query: CustomRulesQuery): CustomRulesView {
  const { rules } = query;
  const seatHref = (seats: Seats) =>
    customRulesHref(query, { rules: { ...rules, seats } });
  return {
    name: query.name,
    custom: !isStandard(rules),
    differences: describeDifferences(rules),
    steppers: [
      step(query, 'speechMinutes', speechRange, 'Speech length', 'Per speech'),
      step(query, 'prepMinutes', prepRange, 'Prep time', 'Per side'),
    ],
    seats: [
      {
        label: 'Both sides',
        href: seatHref('both'),
        selected: rules.seats === 'both',
      },
      {
        label: 'One side, solo',
        href: seatHref('solo'),
        selected: rules.seats === 'solo',
      },
    ],
    saved: query.saved,
    ranked: query.ranked ? { reasons: rankedRefusal(rules) } : null,
    practiceHref: practiceHref(
      trainDestinations.practice,
      {
        ...defaultConfig,
        opponent: rules.seats === 'solo' ? 'solo' : defaultConfig.opponent,
        rules,
      },
      query.plan,
    ),
    askRankedHref: customRulesHref(query, { ranked: true }),
    closeRankedHref: customRulesHref(query),
    backHref: withPlanContext(trainDestinations.hub, query.plan),
  };
}

/** The way to save the set: the next step of the mock flow. */
export const saveRuleSetHref = (query: CustomRulesQuery): string =>
  customRulesHref(query, { saved: true });

export type RuleSetLink = {
  readonly id: string;
  readonly name: string;
  readonly href: string;
};

/** Each saved rule set as a link that starts a practice under its rules. */
export const ruleSetLinks = (
  ruleSets: readonly { id: string; name: string; rules: PracticeRules }[],
  plan: HubQuery,
): readonly RuleSetLink[] =>
  ruleSets.map((set) => ({
    id: set.id,
    name: set.name,
    href: practiceHref(
      trainDestinations.practice,
      {
        ...defaultConfig,
        opponent: set.rules.seats === 'solo' ? 'solo' : defaultConfig.opponent,
        rules: set.rules,
      },
      plan,
    ),
  }));
