import type { Id } from '../shapes/competition';
import type {
  Collision,
  Draw,
  DrawAnswer,
  DrawInput,
  EventRequest,
  Plan,
  RuleBreak,
} from '../shapes/draw';
import { progression, bracketViolations } from './bracket';
import { byeViolations } from './byes';
import {
  costContext,
  effectiveCutoff,
  judgesOf,
  placedOf,
  requestsOf,
} from './context';
import { infeasibleRulesViolations, optimalityViolations } from './optimality';
import { panelCapacity } from './panels';
import { countedResults, entriesIn, pastFixtures, pastResults } from './past';
import { recordViolations } from './record';
import {
  breaksDifference,
  breaksOf,
  costViolations,
  ruleViolations,
} from './rules';
import {
  eventViolations,
  matchPlans,
  panelViolations,
  slotViolations,
  type Matched,
} from './structure';
import { verdictOf, type Verdict, type Violation } from './verdict';

export { checkBreaks, checkStandings } from './folds';
export type { Verdict, Violation } from './verdict';

/** Facts 2–7 over matched plans: structure, byes, bracket, panels, slot and rules. */
const matchedViolations = (
  input: DrawInput,
  matched: readonly Matched[],
  overrides: readonly RuleBreak[],
  short = false,
): Violation[] => [
  ...matched.flatMap(({ request, plan }) => [
    ...eventViolations(request, plan),
    ...byeViolations(request, plan),
    ...bracketViolations(request, plan),
  ]),
  ...panelViolations(input, matched, short),
  ...slotViolations(input, matched),
  ...matched.flatMap((m) =>
    ruleViolations(costContext(input, m.request), m.plan, overrides),
  ),
];

/** Facts 1–7 over a call's plans. */
const planViolations = (
  input: DrawInput,
  plans: readonly Plan[],
  overrides: readonly RuleBreak[],
  short = false,
): {
  readonly matched: readonly Matched[];
  readonly violations: readonly Violation[];
} => {
  const { matched, violations } = matchPlans(input, plans);
  return {
    matched,
    violations: [
      ...violations,
      ...matchedViolations(input, matched, overrides, short),
    ],
  };
};

/** The checks for a plan a person changed: structure and rules, the given overrides accepted exactly. */
export const checkPlans = (
  input: DrawInput,
  plans: readonly Plan[],
  overrides: readonly RuleBreak[],
): Verdict => verdictOf(planViolations(input, plans, overrides).violations);

/** Everyone the slot already holds outside one event: other events' fixtures and the commitments. */
const occupiedOutside = (
  input: DrawInput,
  matched: readonly Matched[],
  event: Id,
): ReadonlySet<Id> => {
  if (input.call !== 'slot') return new Set();
  const judges = judgesOf(input);
  const people = new Set(input.commitments.flatMap((c) => c.people));
  for (const { request, plan } of matched) {
    if (request.event === event) continue;
    const members = new Map(request.entries.map((e) => [e.id, e.members]));
    for (const { fixture } of placedOf(plan)) {
      if (fixture.kind === 'bye') continue;
      for (const entry of entriesIn(fixture))
        for (const person of members.get(entry) ?? []) people.add(person);
      for (const id of fixture.panel) {
        const judge = judges?.get(id);
        if (judge !== undefined) people.add(judge.person);
      }
    }
  }
  return people;
};

const drawnViolations = (
  input: DrawInput,
  draws: readonly Draw[],
  overrides: readonly RuleBreak[],
): Violation[] => {
  const { matched, violations } = planViolations(input, draws, overrides);
  return [
    ...violations,
    ...matched.flatMap(({ request, plan }) => {
      const draw = plan as Draw;
      const ctx = costContext(input, request);
      return [
        ...(draw.tabRound === request.tabRound
          ? []
          : [
              {
                kind: 'draw_tab_round',
                event: request.event,
                expected: request.tabRound,
                actual: draw.tabRound,
              } as const,
            ]),
        ...costViolations(ctx, draw),
        ...recordViolations(input, request, draw),
        ...optimalityViolations(
          ctx,
          draw,
          occupiedOutside(input, matched, request.event),
        ),
      ];
    }),
  ];
};

/** Each named person really is held twice in the slot: by two active entries, or an entry and a commitment. */
const slotCollisionViolations = (
  input: DrawInput,
  collisions: readonly Collision[],
): Violation[] => {
  const holds = (person: Id) => {
    const entries = requestsOf(input).flatMap((r) =>
      r.entries.filter(
        (e) => e.status === 'active' && e.members.includes(person),
      ),
    ).length;
    const commitments =
      input.call === 'slot'
        ? input.commitments.filter((c) => c.people.includes(person)).length
        : 0;
    return entries + commitments;
  };
  return collisions
    .filter((c) => holds(c.person) < 2)
    .map((c): Violation => ({
      kind: 'infeasible_slot_unfounded',
      person: c.person,
    }));
};

/** The needed results a draw of this request cannot be made without. */
const neededMissing = (request: EventRequest): readonly (Id | null)[] => {
  const p = progression(request);
  if (p !== null) return p.kind === 'missing' ? p.fixtures : [];
  const cutoff = effectiveCutoff(request);
  const counted = countedResults(
    pastFixtures(request.history),
    pastResults(request.history),
    cutoff,
  );
  return pastFixtures(request.history)
    .filter(
      (f) =>
        f.tabRound <= cutoff && f.fixture.kind !== 'bye' && !counted.has(f.id),
    )
    .map((f) => f.id);
};

const infeasibleViolations = (
  input: DrawInput,
  answer: Extract<DrawAnswer, { readonly kind: 'infeasible' }>,
): Violation[] => {
  switch (answer.cause) {
    case 'rules':
      // A claim the checker cannot brute force is accepted unchecked; see infeasibleRulesViolations.
      return infeasibleRulesViolations(input, answer.event, answer.rules);
    case 'slot':
      return slotCollisionViolations(input, answer.collisions);
    case 'panels': {
      const { matched, violations } = planViolations(
        input,
        answer.draws,
        [],
        true,
      );
      const { open, fillable } = panelCapacity(input, matched);
      return [
        ...violations,
        ...(input.judges !== null && fillable < open
          ? []
          : [
              {
                kind: 'infeasible_panels_unfounded',
                open,
                fillable,
              } as const,
            ]),
      ];
    }
    case 'structure': {
      // 'no_plan' is accepted unchecked: the checker restates no planner.
      if (answer.fact === 'no_plan') return [];
      const request = requestsOf(input).find((r) => r.event === answer.event);
      if (request === undefined)
        return [{ kind: 'draw_extra', event: answer.event }];
      const needed = neededMissing(request);
      return needed.includes(answer.fixture) || needed.includes(null)
        ? []
        : [
            {
              kind: 'infeasible_structure_unfounded',
              event: answer.event,
              fixture: answer.fixture,
            },
          ];
    }
  }
};

/**
 * An unresolved answer's attempt holds every structural fact and breaks only
 * the rules it names, and it names exactly the rules its attempt breaks.
 */
const unresolvedViolations = (
  input: DrawInput,
  answer: Extract<DrawAnswer, { readonly kind: 'unresolved' }>,
): Violation[] => {
  const request = requestsOf(input).find((r) => r.event === answer.event);
  if (request === undefined || answer.attempt.event !== answer.event)
    return [{ kind: 'draw_extra', event: answer.attempt.event }];
  const matched = [{ request, plan: answer.attempt }];
  const { missing, extra } = breaksDifference(
    breaksOf(costContext(input, request), answer.attempt, 'rule'),
    answer.broken,
  );
  // The attempt is the pairing the method could not resolve, made before any judge is seated: its panels may be short.
  return [
    ...matchedViolations(input, matched, answer.broken, true),
    ...(missing.length > 0 || extra.length > 0
      ? [
          {
            kind: 'unresolved_broken',
            event: answer.event,
            missing,
            extra,
          } as const,
        ]
      : []),
  ];
};

/** The independent second reading of a draw answer. */
export const check = (
  input: DrawInput,
  answer: DrawAnswer,
  overrides: readonly RuleBreak[] = [],
): Verdict => {
  switch (answer.kind) {
    case 'drawn':
      return verdictOf(drawnViolations(input, answer.draws, overrides));
    case 'infeasible':
      return verdictOf(infeasibleViolations(input, answer));
    case 'unresolved':
      return verdictOf(unresolvedViolations(input, answer));
  }
};
