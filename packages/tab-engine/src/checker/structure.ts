import type { Fixture, Id } from '../shapes/competition';
import type {
  DrawInput,
  EventRequest,
  ExistingFixture,
  Plan,
} from '../shapes/draw';
import {
  judgesOf,
  placedOf,
  requestsOf,
  sameRef,
  sidesOf,
  type Placed,
} from './context';
import { entriesIn, panelOf, pastFixtures, pastOf } from './past';
import type { Holder, Violation } from './verdict';

export type Matched = { readonly request: EventRequest; readonly plan: Plan };

/** Fact 1: exactly one plan per event request, and nothing else. */
export const matchPlans = (
  input: DrawInput,
  plans: readonly Plan[],
): {
  readonly matched: readonly Matched[];
  readonly violations: readonly Violation[];
} => {
  const violations: Violation[] = [];
  const matched: Matched[] = [];
  const requests = requestsOf(input);
  for (const request of requests) {
    const mine = plans.filter((p) => p.event === request.event);
    if (mine.length === 0)
      violations.push({ kind: 'draw_missing', event: request.event });
    else matched.push({ request, plan: mine[0]! });
    for (const extra of mine.slice(1))
      violations.push({ kind: 'draw_extra', event: extra.event });
  }
  const known = new Set(requests.map((r) => r.event));
  for (const plan of plans)
    if (!known.has(plan.event))
      violations.push({ kind: 'draw_extra', event: plan.event });
  return { matched, violations };
};

/** Fact 4: the fixture's kind and size fit the event's format. */
const fitsFormat = (request: EventRequest, fixture: Fixture) => {
  const sides = sidesOf(request);
  switch (fixture.kind) {
    case 'bye':
      return true;
    case 'pairing':
      return sides !== null && fixture.sides.length === sides;
    case 'section':
      return sides === null;
  }
};

const sameEntries = (a: Fixture, b: Fixture) => {
  if (a.kind !== b.kind) return false;
  const left = entriesIn(a);
  const right = entriesIn(b);
  return (
    left.length === right.length && left.every((entry, i) => entry === right[i])
  );
};

/** Fact 3: every existing fixture accounted once; fixed ones kept; kept ones unchanged. */
const existingViolations = (request: EventRequest, plan: Plan): Violation[] => {
  const event = request.event;
  const violations: Violation[] = [];
  const existing = new Map(
    (request.existing as readonly ExistingFixture<never>[]).map((e) => [
      e.id,
      e,
    ]),
  );
  const keptIds = plan.keep.map((k) => k.id);
  for (const id of [...keptIds, ...plan.withdraw])
    if (!existing.has(id))
      violations.push({ kind: 'existing_unknown', event, fixture: id });
  for (const [id, before] of existing) {
    const kept = keptIds.filter((k) => k === id).length;
    const withdrawn = plan.withdraw.filter((w) => w === id).length;
    if (kept + withdrawn === 0)
      violations.push({ kind: 'existing_unaccounted', event, fixture: id });
    if (kept + withdrawn > 1)
      violations.push({ kind: 'existing_twice', event, fixture: id });
    if (before.hold === 'fixed' && withdrawn > 0)
      violations.push({ kind: 'fixed_fixture_withdrawn', event, fixture: id });
  }
  for (const kept of plan.keep) {
    const before = existing.get(kept.id);
    if (before === undefined) continue;
    const was = before.fixture as Fixture;
    const now = kept.fixture as Fixture;
    if (!sameEntries(was, now))
      violations.push({
        kind: 'kept_fixture_changed',
        event,
        fixture: kept.id,
      });
    const seats = panelOf(now);
    panelOf(was).forEach((judge, seat) => {
      if (seats[seat] !== judge)
        violations.push({
          kind: 'seated_judge_removed',
          event,
          fixture: kept.id,
          seat,
          judge,
        });
    });
  }
  return violations;
};

/** Fact 2: who is placed, and where. */
const placementViolations = (
  request: EventRequest,
  placed: readonly Placed[],
): Violation[] => {
  const event = request.event;
  const violations: Violation[] = [];
  const entries = new Map(request.entries.map((e) => [e.id, e]));
  const seen = new Set<Id>();
  const stage = request.stage;
  const seeds =
    stage.kind === 'elimination' ? new Set(stage.bracket.seeds) : null;
  for (const { ref, fixture, added } of placed)
    for (const entry of entriesIn(fixture)) {
      if (seen.has(entry))
        violations.push({
          kind: 'entry_placed_twice',
          event,
          entry,
          fixture: ref,
        });
      seen.add(entry);
      if (seeds !== null && !seeds.has(entry))
        violations.push({
          kind: 'entry_not_in_bracket',
          event,
          entry,
          fixture: ref,
        });
      const known = entries.get(entry);
      if (known === undefined)
        violations.push({ kind: 'entry_unknown', event, entry, fixture: ref });
      else if (added && known.status === 'withdrawn')
        violations.push({
          kind: 'withdrawn_entry_placed',
          event,
          entry,
          fixture: ref,
        });
    }
  if (seeds === null)
    for (const entry of request.entries)
      if (entry.status === 'active' && !seen.has(entry.id))
        violations.push({ kind: 'entry_not_placed', event, entry: entry.id });
  return violations;
};

/**
 * A prematched stage is drawn with every earlier pair of the stage removed:
 * two entries who met before are never paired again, whatever the rematch
 * setting says. It is the schedule, not a rule, so no override covers it.
 */
const prematchedViolations = (
  request: EventRequest,
  placed: readonly Placed[],
): Violation[] => {
  if (
    request.stage.kind !== 'preliminary' ||
    request.settings['pairing.method'].preliminary.structure !== 'prematched'
  )
    return [];
  const past = pastOf(pastFixtures(request.history), request.tabRound);
  return placed.flatMap(({ ref, fixture }) => {
    if (fixture.kind !== 'pairing') return [];
    const held = fixture.sides;
    return held.flatMap((a, i) =>
      held
        .slice(i + 1)
        .filter((b) => past.meetings(a, b) > 0)
        .map((b): Violation => ({
          kind: 'prematched_repeat',
          event: request.event,
          fixture: ref,
          entries: [a, b],
        })),
    );
  });
};

/** Facts 2–4 for one event's plan. */
export const eventViolations = (
  request: EventRequest,
  plan: Plan,
): Violation[] => {
  const placed = placedOf(plan);
  return [
    ...existingViolations(request, plan),
    ...placementViolations(request, placed),
    ...prematchedViolations(request, placed),
    ...placed
      .filter(({ fixture }) => !fitsFormat(request, fixture))
      .map(({ ref }): Violation => ({
        kind: 'fixture_kind',
        event: request.event,
        fixture: ref,
      })),
  ];
};

/**
 * Fact 5: panel sizes, and each judge seated once, where they may judge and
 * never on a fixture holding their own entry. With `short`, a panel may hold
 * fewer judges than its size (an answer that could not seat them all).
 */
export const panelViolations = (
  input: DrawInput,
  matched: readonly Matched[],
  short = false,
): Violation[] => {
  const violations: Violation[] = [];
  const judges = judgesOf(input);
  const seatsOf = new Map<Id, Holder[]>();
  for (const { request, plan } of matched) {
    const event = request.event;
    const size = request.settings['judging.panel'][request.stage.kind].size;
    const members = new Map(request.entries.map((e) => [e.id, e.members]));
    for (const { ref, fixture } of placedOf(plan)) {
      if (fixture.kind === 'bye') continue;
      const panel = fixture.panel;
      const competitors = new Set(
        entriesIn(fixture).flatMap((entry) => members.get(entry) ?? []),
      );
      if (
        panel.length > size ||
        (!short && judges !== null && panel.length !== size)
      )
        violations.push({
          kind: 'panel_size',
          event,
          fixture: ref,
          size: panel.length,
          expected: size,
        });
      for (const id of panel) {
        seatsOf.set(id, [
          ...(seatsOf.get(id) ?? []),
          { kind: 'fixture', event, fixture: ref },
        ]);
        if (judges === null) continue;
        const judge = judges.get(id);
        if (judge === undefined)
          violations.push({
            kind: 'judge_unknown',
            event,
            fixture: ref,
            judge: id,
          });
        else if (judge.events !== null && !judge.events.includes(event))
          violations.push({
            kind: 'judge_not_eligible',
            event,
            fixture: ref,
            judge: id,
          });
        if (judge !== undefined && competitors.has(judge.person))
          violations.push({
            kind: 'judge_competing',
            event,
            fixture: ref,
            judge: id,
            person: judge.person,
          });
      }
    }
  }
  for (const [judge, at] of seatsOf)
    if (at.length > 1) violations.push({ kind: 'judge_twice', judge, at });
  return violations;
};

/** Fact 6: in a slot, nobody is held twice, and nobody judges while competing. */
export const slotViolations = (
  input: DrawInput,
  matched: readonly Matched[],
): Violation[] => {
  if (input.call !== 'slot') return [];
  const violations: Violation[] = [];
  const judges = judgesOf(input);
  const holders = new Map<Id, Holder[]>();
  const hold = (people: Iterable<Id>, holder: Holder) => {
    for (const person of new Set(people))
      holders.set(person, [...(holders.get(person) ?? []), holder]);
  };
  /** Where each competitor competes; the same fixture is fact 5's. */
  const competing = new Map<
    Id,
    { readonly event: Id; readonly ref: Placed['ref'] }[]
  >();
  const seated: {
    readonly event: Id;
    readonly ref: Placed['ref'];
    readonly judge: Id;
    readonly person: Id;
  }[] = [];
  for (const { request, plan } of matched) {
    const members = new Map(request.entries.map((e) => [e.id, e.members]));
    for (const { ref, fixture } of placedOf(plan)) {
      if (fixture.kind === 'bye') continue;
      const people = entriesIn(fixture).flatMap(
        (entry) => members.get(entry) ?? [],
      );
      for (const person of people)
        competing.set(person, [
          ...(competing.get(person) ?? []),
          { event: request.event, ref },
        ]);
      const judgePeople = fixture.panel.flatMap((id) => {
        const judge = judges?.get(id);
        if (judge === undefined) return [];
        seated.push({
          event: request.event,
          ref,
          judge: id,
          person: judge.person,
        });
        return [judge.person];
      });
      hold([...people, ...judgePeople], {
        kind: 'fixture',
        event: request.event,
        fixture: ref,
      });
    }
  }
  for (const c of input.commitments)
    hold(c.people, { kind: 'commitment', event: c.event, fixture: c.fixture });
  for (const [person, at] of holders)
    if (at.length > 1)
      violations.push({ kind: 'person_twice_in_slot', person, holders: at });
  for (const s of seated)
    if (
      (competing.get(s.person) ?? []).some(
        (at) => !(at.event === s.event && sameRef(at.ref, s.ref)),
      )
    )
      violations.push({
        kind: 'judge_competing',
        event: s.event,
        fixture: s.ref,
        judge: s.judge,
        person: s.person,
      });
  return violations;
};
