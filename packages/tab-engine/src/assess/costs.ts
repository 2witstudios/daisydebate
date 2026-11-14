import { panelOf, type EventFacts } from '../draw/facts';
import type { Prepared } from '../draw/prepare';
import { methodCost } from '../draw/two-sided';
import type { Fixture, Id } from '../shapes/competition';
import type { CostKey, Judge, SlotJudge, TermCost } from '../shapes/draw';
import {
  byeRecipientTerm,
  forceOf,
  pairingKeys,
  pairingTerms,
  panelSameSchool,
  seatKeys,
  seatTerms,
} from '../settings/registry';

/** The within-group method's cost of each pairing in a plan, from the plan's own record groups. */
export const methodCosts = (prepared: Prepared, fixtures: readonly Fixture[]): Map<number, number> => {
  const out = new Map<number, number>();
  const method = prepared.method;
  if (method.kind !== 'matched' || !method.grouped) return out;
  const facts = prepared.facts;
  const groups = new Map<number, { index: number; sides: readonly Id[] }[]>();
  fixtures.forEach((fixture, index) => {
    if (fixture.kind !== 'pairing') return;
    const top = Math.max(...fixture.sides.map((e) => facts.record.get(e) ?? 0));
    groups.set(top, [...(groups.get(top) ?? []), { index, sides: fixture.sides }]);
  });
  for (const members of groups.values()) {
    const ranked = members
      .flatMap((m) => m.sides)
      .sort((a, b) => (facts.strength.get(a) ?? 0) - (facts.strength.get(b) ?? 0));
    for (const { index, sides } of members) {
      const [i, j] = sides.map((e) => ranked.indexOf(e)).sort((x, y) => x - y);
      out.set(index, methodCost(method.later, i!, j!, ranked.length));
    }
  }
  return out;
};

/** Every term that applies to one fixture, with its force and cost. */
export const fixtureTerms = (
  facts: EventFacts,
  fixture: Fixture,
  method: number | undefined,
  judges: ReadonlyMap<Id, Judge | SlotJudge> | null,
  leastLoad: number,
): TermCost[] => {
  const terms: TermCost[] = [];
  for (const key of pairingKeys) {
    const force = forceOf(facts.settings, key);
    const cost = pairingTerms[key](facts, fixture);
    if (force !== 'off' && cost !== null) terms.push({ key, force, cost });
  }
  const bye = byeRecipientTerm(facts, fixture);
  if (bye !== null) terms.push({ key: 'bye.recipient', force: null, cost: bye });
  if (method !== undefined) terms.push({ key: 'pairing.method', force: null, cost: [method] });
  if (judges === null || fixture.kind === 'bye') return terms;
  const seated = panelOf(fixture).flatMap((id, seat) => {
    const judge = judges.get(id);
    return judge === undefined ? [] : [{ judge, seat }];
  });
  for (const key of seatKeys) {
    const force = forceOf(facts.settings, key);
    if (force === 'off') continue;
    const cost = seated.reduce(
      (sum, { judge, seat }) => sum + seatTerms[key]({ facts, fixture, seat, judge, leastLoad }),
      0,
    );
    terms.push({ key, force, cost: [cost] });
  }
  const panelForce = forceOf(facts.settings, 'judging.panel_same_school');
  if (panelForce !== 'off')
    terms.push({ key: 'judging.panel_same_school', force: panelForce, cost: [panelSameSchool(fixture, judges)] });
  return terms;
};

export const addCost = (totals: Map<CostKey, number[]>, key: CostKey, cost: readonly number[]) => {
  const held = totals.get(key);
  totals.set(key, held === undefined ? [...cost] : held.map((v, i) => v + (cost[i] ?? 0)));
};

