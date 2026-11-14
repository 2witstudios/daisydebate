import { entriesOf, panelOf } from '../draw/facts';
import type { Prepared } from '../draw/prepare';
import type { Fixture, Id } from '../shapes/competition';
import type {
  Assessment,
  CostKey,
  Exchange,
  FixtureAssessment,
  FixtureRef,
  InvalidFact,
  Judge,
  Plan,
  RuleBreak,
  SlotJudge,
} from '../shapes/draw';
import type { ForceKey } from '../shapes/settings';
import { pairingKeys, pairingTerms, forceOf } from '../settings/registry';
import { compareVectors } from '../solve/lexicographic';
import { addCost, fixtureTerms, methodCosts } from './costs';

/** What a whole call shares when its plans are costed. */
export type CallContext = {
  readonly judges: ReadonlyMap<Id, Judge | SlotJudge> | null;
  readonly leastLoad: number;
  /** In a slot: who the commitments occupy. */
  readonly committed: ReadonlyMap<Id, Id>;
  readonly slot: boolean;
};

type Placed = { readonly ref: FixtureRef; readonly fixture: Fixture };

export const placedOf = (plan: Plan): Placed[] => [
  ...plan.keep.map((k) => ({
    ref: { kind: 'existing', id: k.id } as const,
    fixture: k.fixture as Fixture,
  })),
  ...plan.add.map((a) => ({
    ref: { kind: 'new', ordinal: a.ordinal } as const,
    fixture: a.fixture as Fixture,
  })),
];

const fitsFormat = (prepared: Prepared, fixture: Fixture) => {
  const format = prepared.request.format;
  if (fixture.kind === 'bye') return true;
  if (format.outcome === 'winner')
    return fixture.kind === 'pairing' && fixture.sides.length === 2;
  if ('sides' in format)
    return fixture.kind === 'pairing' && fixture.sides.length === 4;
  return fixture.kind === 'section';
};

const panelSize = (prepared: Prepared) =>
  prepared.request.settings['judging.panel'][prepared.request.stage.kind].size;

/** Facts no override covers, inside one event's plan. */
const structuralFacts = (
  prepared: Prepared,
  plan: Plan,
  context: CallContext,
): InvalidFact[] => {
  const event = prepared.request.event;
  const out: InvalidFact[] = [];
  const placed = placedOf(plan);
  const seen = new Map<Id, number>();
  for (const { fixture } of placed)
    for (const e of entriesOf(fixture)) seen.set(e, (seen.get(e) ?? 0) + 1);
  for (const [entry, times] of seen)
    if (times > 1) out.push({ fact: 'entry_placed_twice', event, entry });
  const status = new Map(prepared.request.entries.map((e) => [e.id, e.status]));
  for (const a of plan.add)
    for (const e of entriesOf(a.fixture as Fixture))
      if (status.get(e) !== 'active')
        out.push({ fact: 'withdrawn_entry_placed', event, entry: e });
  if (prepared.request.stage.kind === 'preliminary')
    for (const entry of prepared.request.entries)
      if (entry.status === 'active' && !seen.has(entry.id))
        out.push({ fact: 'entry_not_placed', event, entry: entry.id });
  const kept = new Map(plan.keep.map((k) => [k.id, k.fixture as Fixture]));
  const withdrawn = new Set(plan.withdraw);
  for (const existing of prepared.request.existing) {
    const fixture = existing.fixture as Fixture;
    const keptAs = kept.get(existing.id);
    if (
      (keptAs === undefined) === !withdrawn.has(existing.id) ||
      (keptAs !== undefined && withdrawn.has(existing.id))
    )
      out.push({ fact: 'existing_unaccounted', event, fixture: existing.id });
    if (existing.hold === 'fixed' && keptAs === undefined)
      out.push({ fact: 'fixed_fixture_changed', event, fixture: existing.id });
    if (keptAs === undefined) continue;
    if (
      entriesOf(keptAs).join('|') !== entriesOf(fixture).join('|') ||
      keptAs.kind !== fixture.kind
    )
      out.push({ fact: 'fixed_fixture_changed', event, fixture: existing.id });
    const before = panelOf(fixture);
    if (before.some((judge, seat) => panelOf(keptAs)[seat] !== judge))
      out.push({ fact: 'seated_judge_removed', event, fixture: existing.id });
  }
  for (const { ref, fixture } of placed) {
    if (!fitsFormat(prepared, fixture))
      out.push({ fact: 'fixture_kind', event, fixture: ref });
    if (panelOf(fixture).length > panelSize(prepared))
      out.push({ fact: 'panel_size', event, fixture: ref });
    for (const id of panelOf(fixture)) {
      const judge = context.judges?.get(id);
      if (judge === undefined) continue;
      if (judge.events !== null && !judge.events.includes(event))
        out.push({ fact: 'judge_not_eligible', judge: id, event });
    }
  }
  return out;
};

const rulesBroken = (facts: Prepared['facts'], fixture: Fixture) =>
  pairingKeys.filter(
    (key) =>
      forceOf(facts.settings, key) === 'rule' &&
      (pairingTerms[key](facts, fixture) ?? []).some((c) => c > 0),
  ).length;

/** Lexicographic pairing cost of a fixture: rule breaks, then the weighed keys in order. */
const pairingVector = (prepared: Prepared, fixture: Fixture) => {
  const facts = prepared.facts;
  const order = facts.settings['pairing.preference_order'].order;
  return [
    rulesBroken(facts, fixture),
    ...order
      .filter((key) => forceOf(facts.settings, key) === 'preference')
      .map((key) =>
        (pairingTerms[key](facts, fixture) ?? [0]).reduce((s, c) => s + c, 0),
      ),
  ];
};

const swapped = (fixture: Fixture, at: number, entry: Id): Fixture => {
  switch (fixture.kind) {
    case 'pairing':
      return {
        ...fixture,
        sides: fixture.sides.map((e, i) => (i === at ? entry : e)),
      } as unknown as Fixture;
    case 'section':
      return {
        ...fixture,
        speakers: fixture.speakers.map((e, i) => (i === at ? entry : e)),
      };
    case 'bye':
      return { ...fixture, entry };
  }
};

/** The best single exchange of one entry with another fixture, field by field. */
const bestExchange = (
  prepared: Prepared,
  placed: readonly Placed[],
  index: number,
): Exchange | null => {
  const own = placed[index]!;
  if (own.fixture.kind === 'bye') return null;
  const facts = prepared.facts;
  const keys = pairingKeys.filter(
    (key) => forceOf(facts.settings, key) !== 'off',
  );
  let best: { gain: number[]; exchange: Exchange } | null = null;
  placed.forEach((other, o) => {
    if (o === index || other.fixture.kind !== own.fixture.kind) return;
    const before = [
      pairingVector(prepared, own.fixture),
      pairingVector(prepared, other.fixture),
    ];
    entriesOf(own.fixture).forEach((x, i) =>
      entriesOf(other.fixture).forEach((y, j) => {
        const a = swapped(own.fixture, i, y);
        const b = swapped(other.fixture, j, x);
        const after = [pairingVector(prepared, a), pairingVector(prepared, b)];
        const delta = after[0]!.map(
          (v, k) => v + after[1]![k]! - before[0]![k]! - before[1]![k]!,
        );
        if (best !== null && compareVectors(delta, best.gain) >= 0) return;
        const difference = keys.flatMap((key) => {
          const cost = (f: Fixture) => pairingTerms[key](facts, f) ?? [];
          const diff = [cost(a), cost(b)][0]!.map(
            (v, k) =>
              v +
              (cost(b)[k] ?? 0) -
              (cost(own.fixture)[k] ?? 0) -
              (cost(other.fixture)[k] ?? 0),
          );
          return diff.some((d) => d !== 0)
            ? [{ key: key as CostKey, cost: diff }]
            : [];
        });
        best = {
          gain: delta,
          exchange: { with: other.ref, entries: [x, y], difference },
        };
      }),
    );
  });
  return best === null ? null : (best as { exchange: Exchange }).exchange;
};

/**
 * The one costing of a plan: per fixture, every setting that applied and its
 * cost; totals; warnings; every rule the plan breaks; and every structural
 * fact it breaks. The engine's own draw and a person's changed plan go
 * through this same function.
 */
export const assessPlan = (
  prepared: Prepared,
  plan: Plan,
  context: CallContext,
): Assessment => {
  const placed = placedOf(plan);
  const methods = methodCosts(
    prepared,
    placed.map((p) => p.fixture),
  );
  const totals = new Map<CostKey, number[]>();
  const warnings: RuleBreak[] = [];
  const broken: RuleBreak[] = [];
  const fixtures: FixtureAssessment[] = placed.map(
    ({ ref, fixture }, index) => {
      const terms = fixtureTerms(
        prepared.facts,
        fixture,
        methods.get(index),
        context.judges,
        context.leastLoad,
      );
      for (const term of terms) {
        addCost(totals, term.key, term.cost);
        if (!term.cost.some((c) => c > 0) || term.force === null) continue;
        const at = {
          event: prepared.request.event,
          key: term.key as ForceKey,
          fixture: ref,
        };
        if (term.force === 'rule') broken.push(at);
        if (term.force === 'warning') warnings.push(at);
      }
      return {
        fixture: ref,
        terms,
        exchange: bestExchange(prepared, placed, index),
      };
    },
  );
  const movable = new Set(
    prepared.request.existing
      .filter((f) => f.hold === 'movable')
      .map((f) => f.id),
  );
  addCost(totals, 'keep', [
    plan.withdraw.filter((id) => movable.has(id)).length,
  ]);
  return {
    fixtures,
    totals: [...totals]
      .map(([key, cost]) => ({ key, cost }))
      .sort((a, b) => (a.key < b.key ? -1 : 1)),
    warnings,
    broken,
    invalid: structuralFacts(prepared, plan, context),
  };
};

/** Facts that span the plans of one call: a judge twice, a person twice in the slot. */
export const callFacts = (
  plans: readonly Plan[],
  context: CallContext,
  people: ReadonlyMap<Id, readonly Id[]>,
): InvalidFact[] => {
  const out: InvalidFact[] = [];
  const judgeSeats = new Map<Id, number>();
  const personFixtures = new Map<Id, number>();
  for (const plan of plans)
    for (const { fixture } of placedOf(plan)) {
      if (fixture.kind === 'bye') continue;
      const persons = new Set<Id>();
      for (const id of panelOf(fixture)) {
        judgeSeats.set(id, (judgeSeats.get(id) ?? 0) + 1);
        const person = context.judges?.get(id)?.person;
        if (person !== undefined) persons.add(person);
      }
      for (const e of entriesOf(fixture))
        for (const person of people.get(e) ?? []) persons.add(person);
      for (const person of persons)
        personFixtures.set(person, (personFixtures.get(person) ?? 0) + 1);
    }
  for (const [judge, seats] of judgeSeats)
    if (seats > 1) out.push({ fact: 'judge_twice', judge });
  if (context.slot) {
    for (const person of context.committed.keys())
      personFixtures.set(person, (personFixtures.get(person) ?? 0) + 1);
    for (const [person, times] of personFixtures)
      if (times > 1) out.push({ fact: 'person_twice_in_slot', person });
  }
  return out.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
};
