import type { Id } from '../shapes/competition';
import type {
  Collision,
  Draw,
  DrawAnswer,
  DrawInput,
  Plan,
  RuleBreak,
} from '../shapes/draw';
import { costContext, judgesOf, placedOf, requestsOf } from './context';
import { infeasibleRulesViolations, optimalityViolations } from './optimality';
import { entriesIn } from './past';
import { recordViolations } from './record';
import { costViolations, ruleViolations } from './rules';
import {
  eventViolations,
  matchPlans,
  panelViolations,
  slotViolations,
  type Matched,
} from './structure';
import { verdictOf, type Verdict, type Violation } from './verdict';

export { checkBreaks, checkStandings } from './folds';
export type { Holder, Verdict, Violation } from './verdict';

/** Facts 1–7 over a call's plans. */
const planViolations = (
  input: DrawInput,
  plans: readonly Plan[],
  overrides: readonly RuleBreak[],
  cutoffOf: (m: Matched) => number,
): {
  readonly matched: readonly Matched[];
  readonly violations: readonly Violation[];
} => {
  const { matched, violations } = matchPlans(input, plans);
  return {
    matched,
    violations: [
      ...violations,
      ...matched.flatMap(({ request, plan }) => eventViolations(request, plan)),
      ...panelViolations(input, matched),
      ...slotViolations(input, matched),
      ...matched.flatMap((m) =>
        ruleViolations(
          costContext(input, m.request, cutoffOf(m)),
          m.plan,
          overrides,
        ),
      ),
    ],
  };
};

/** The checks for a plan a person changed: structure and rules, the given overrides accepted exactly. */
export const checkPlans = (
  input: DrawInput,
  plans: readonly Plan[],
  overrides: readonly RuleBreak[],
): Verdict =>
  verdictOf(
    planViolations(input, plans, overrides, (m) => m.request.cutoff).violations,
  );

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
  const { matched, violations } = planViolations(
    input,
    draws,
    overrides,
    (m) => (m.plan as Draw).inputs.cutoff,
  );
  return [
    ...violations,
    ...matched.flatMap(({ request, plan }) => {
      const draw = plan as Draw;
      const ctx = costContext(input, request, draw.inputs.cutoff);
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
          input,
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

const infeasibleViolations = (
  input: DrawInput,
  answer: Extract<DrawAnswer, { readonly kind: 'infeasible' }>,
): Violation[] => {
  switch (answer.cause) {
    case 'rules':
      return infeasibleRulesViolations(input, answer.event, answer.rules);
    case 'slot':
      return slotCollisionViolations(input, answer.collisions);
    case 'panels':
    case 'structure':
      return [];
  }
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
      return verdictOf([]);
  }
};
