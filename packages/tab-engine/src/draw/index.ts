import { canonicalOrder } from '@daisy/seeded-random';
import { assessPlan, callFacts, type CallContext } from '../assess/assessment';
import type { Entry, Fixture, Id } from '../shapes/competition';
import type {
  Draw,
  DrawAnswer,
  DrawInput,
  EventRequest,
  Judge,
  Plan,
  SlotJudge,
} from '../shapes/draw';
import { entriesOf } from './facts';
import { FOUR_SIDE_VERSION } from './four-side';
import { inputsRecord } from './inputs-record';
import { JUDGES_VERSION, staff, type StaffTask } from './judges';
import { conflictingRules, placeWith } from './place';
import type { Placed } from './placement';
import { prepare, type Prepared } from './prepare';
import { PROGRESSION_VERSION } from './progression';
import { ROUND_ROBIN_VERSION } from './schedule';
import { SECTIONS_VERSION } from './sections';
import { seatedJudges, slotCollisions } from './slot';
import { TWO_SIDED_VERSION } from './two-sided';

const versionOf = (prepared: Prepared): Record<string, string> => {
  const method = (() => {
    switch (prepared.method.kind) {
      case 'matched':
      case 'prematched':
        return TWO_SIDED_VERSION;
      case 'round_robin':
        return ROUND_ROBIN_VERSION;
      case 'four_side':
        return FOUR_SIDE_VERSION;
      case 'sections':
        return SECTIONS_VERSION;
      case 'progression':
        return PROGRESSION_VERSION;
    }
  })();
  return { method, judges: JUDGES_VERSION };
};

export const requestsOf = (input: DrawInput): readonly EventRequest[] =>
  canonicalOrder(
    (input.call === 'slot' ? input.events : [input.event]).map((r) => ({
      ...r,
      id: r.event,
    })),
  ).map(({ id: _id, ...request }) => request as EventRequest);

export const callContext = (input: DrawInput): CallContext => {
  const judges = input.judges;
  const committed = new Map<Id, Id>();
  if (input.call === 'slot')
    for (const c of input.commitments)
      for (const person of c.people) committed.set(person, c.fixture);
  return {
    judges:
      judges === null
        ? null
        : new Map<Id, Judge | SlotJudge>(judges.map((j) => [j.id, j])),
    leastLoad: Math.min(
      ...(judges ?? []).map((j) => j.tabRoundsJudged),
      Infinity,
    ),
    committed,
    slot: input.call === 'slot',
  };
};

/** Each entry's members, for the slot rule. */
export const peopleOf = (requests: readonly EventRequest[]) =>
  new Map(
    requests.flatMap((r) => r.entries.map((e) => [e.id, e.members] as const)),
  );

const asPlan = (
  prepared: Prepared,
  placed: Placed,
  panels: ReadonlyMap<Fixture, readonly Id[]>,
): Plan => {
  const withPanel = (fixture: Fixture): Fixture =>
    fixture.kind === 'bye'
      ? fixture
      : { ...fixture, panel: panels.get(fixture) ?? fixture.panel };
  return {
    event: prepared.request.event,
    keep: placed.kept.map((k) => ({ id: k.id, fixture: withPanel(k.fixture) })),
    add: placed.added.map((fixture, i) => ({
      ordinal: i + 1,
      fixture: withPanel(fixture),
    })),
    withdraw: [...placed.withdrawn].sort(),
  } as Plan;
};

/** The solver's own plan, passed through `assess` before it is returned. */
const finish = (
  input: DrawInput,
  prepared: readonly Prepared[],
  plans: readonly Plan[],
): Draw[] => {
  const context = callContext(input);
  const shared = callFacts(
    plans,
    context,
    peopleOf(prepared.map((p) => p.request)),
  );
  return plans.map((plan, i) => {
    const p = prepared[i]!;
    const assessment = assessPlan(p, plan, context);
    return {
      ...plan,
      format: p.request.format,
      tabRound: p.request.tabRound,
      assessment: {
        ...assessment,
        invalid: [...assessment.invalid, ...shared],
      },
      inputs: inputsRecord(p, input, prepared, versionOf(p)),
    } as Draw;
  });
};

const fixtureEntries = (prepared: Prepared, placed: Placed): Entry[] => {
  const byId = new Map(prepared.request.entries.map((e) => [e.id, e]));
  return [...placed.kept.map((k) => k.fixture), ...placed.added]
    .flatMap((f) => entriesOf(f))
    .flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
};

/**
 * The one draw: for one time slot, places the entries of one or more events
 * into fixtures and seats judges across all of them, keeping, adding and
 * withdrawing against the fixtures that exist; or the same for one tab round
 * of a windowed stage. The method is chosen from each event's format and
 * stage, never by the caller. All or nothing: one draw per event, or one
 * reason why not.
 */
export const draw = (input: DrawInput): DrawAnswer => {
  const prepared = requestsOf(input).map((request) =>
    prepare(request, input.seed),
  );
  const placements: Placed[] = [];
  for (const p of prepared) {
    const answer = placeWith(p, p.request.settings, input.seed);
    switch (answer.kind) {
      case 'placed':
        placements.push(answer.placed);
        break;
      case 'infeasible': {
        const conflict = conflictingRules(p, input.seed);
        return conflict === null
          ? {
              kind: 'infeasible',
              cause: 'structure',
              event: p.request.event,
              fact: 'no_plan',
              fixture: null,
            }
          : {
              kind: 'infeasible',
              cause: 'rules',
              event: p.request.event,
              ...conflict,
            };
      }
      case 'structure':
        return {
          kind: 'infeasible',
          cause: 'structure',
          event: p.request.event,
          fact: answer.fact,
          fixture: answer.fixture,
        };
      case 'unresolved': {
        const attempt = finish(
          input,
          [p],
          [asPlan(p, answer.placed, new Map())],
        )[0]!;
        return {
          kind: 'unresolved',
          event: p.request.event,
          method: versionOf(p).method!,
          attempt,
          broken: attempt.assessment.broken,
        };
      }
    }
  }
  if (input.call === 'slot') {
    const seated = seatedJudges(prepared.map((p) => p.request));
    const judgeHolds = (input.judges ?? [])
      .filter((j) => seated.has(j.id))
      .map((j) => ({
        event: '',
        fixture: `judge:${j.id}`,
        people: [j.person],
      }));
    const collisions = slotCollisions(
      prepared.map((p, i) => ({
        event: p.request.event,
        entries: fixtureEntries(p, placements[i]!),
      })),
      [...input.commitments, ...judgeHolds],
    );
    if (collisions.length > 0)
      return { kind: 'infeasible', cause: 'slot', collisions };
  }
  const panels = new Map<Fixture, readonly Id[]>();
  if (input.judges !== null) {
    const tasks: StaffTask[] = prepared.flatMap((p, i) => {
      const placed = placements[i]!;
      const size =
        p.request.settings['judging.panel'][p.request.stage.kind].size;
      return [
        ...placed.kept.map((k) => ({
          ref: { kind: 'existing', id: k.id } as const,
          fixture: k.fixture,
        })),
        ...placed.added.map((fixture, o) => ({
          ref: { kind: 'new', ordinal: o + 1 } as const,
          fixture,
        })),
      ].flatMap(({ ref, fixture }) =>
        fixture.kind === 'bye' ? [] : [{ facts: p.facts, ref, fixture, size }],
      );
    });
    const committedPeople = new Set(
      input.call === 'slot' ? input.commitments.flatMap((c) => c.people) : [],
    );
    const occupied =
      input.call === 'slot'
        ? new Set([
            ...committedPeople,
            ...tasks
              .flatMap((t) => entriesOf(t.fixture))
              .flatMap(
                (e) => peopleOf(prepared.map((p) => p.request)).get(e) ?? [],
              ),
          ])
        : new Set<Id>();
    const staffing = staff({
      tasks,
      judges: input.judges,
      occupied,
      committedPeople,
      seed: input.seed,
    });
    tasks.forEach((task, t) => panels.set(task.fixture, staffing.panels[t]!));
    if (staffing.kind === 'short') {
      const draws = finish(
        input,
        prepared,
        prepared.map((p, i) => asPlan(p, placements[i]!, panels)),
      );
      return {
        kind: 'infeasible',
        cause: 'panels',
        short: staffing.short,
        removed: staffing.removed,
        committed: staffing.committed,
        draws,
      };
    }
  }
  return {
    kind: 'drawn',
    draws: finish(
      input,
      prepared,
      prepared.map((p, i) => asPlan(p, placements[i]!, panels)),
    ),
  };
};
