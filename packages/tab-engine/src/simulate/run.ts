import { canonicalJson, digestOf } from '@daisy/seeded-random';
import { breaks } from '../breaks';
import { check, checkBreaks, checkStandings } from '../checker';
import { draw } from '../draw';
import type { Entry, FormatDescriptor, Id } from '../shapes/competition';
import type {
  Commitment,
  Draw,
  DrawAnswer,
  DrawInput,
  EventRequest,
  RuleBreak,
  SlotJudge,
} from '../shapes/draw';
import type { BreaksInput, StandingsInput } from '../shapes/folds';
import type { ForceKey, ResolvedSettings } from '../shapes/settings';
import { standings } from '../standings';
import { asHistory, correctionOf, playFixtures, type EventState } from './play';
import {
  dice,
  scenarioOf,
  type Dice,
  type EventPlan,
  type Scenario,
} from './scenario';

/** What one simulated tournament did, and every answer the checker refused. */
export type SimulationReport = {
  readonly seed: string;
  readonly scenario: Scenario;
  readonly calls: number;
  readonly answers: Readonly<Record<string, number>>;
  readonly sharedSlots: boolean;
  readonly rejections: readonly {
    readonly where: string;
    readonly violations: readonly unknown[];
  }[];
};

type Log = {
  calls: number;
  answers: Record<string, number>;
  rejections: { where: string; violations: readonly unknown[] }[];
  kept: { digest: string; draw: Draw }[];
};

const answerKind = (answer: DrawAnswer) =>
  answer.kind === 'infeasible' ? `infeasible:${answer.cause}` : answer.kind;

/** Draws once, has the checker verify the answer, and logs both. */
const drawChecked = (
  log: Log,
  where: string,
  input: DrawInput,
  overrides: readonly RuleBreak[] = [],
): DrawAnswer => {
  const answer = draw(input);
  log.calls += 1;
  log.answers[answerKind(answer)] = (log.answers[answerKind(answer)] ?? 0) + 1;
  const verdict = check(
    input,
    answer,
    answer.kind === 'unresolved' ? answer.broken : overrides,
  );
  if (!verdict.ok)
    log.rejections.push({ where, violations: verdict.violations });
  return answer;
};

const relax = (
  settings: ResolvedSettings,
  keys: readonly ForceKey[],
): ResolvedSettings =>
  keys.reduce(
    (s, key) => ({
      ...s,
      [key]: {
        ...s[key],
        force: key === 'pairing.side_alternation' ? 'off' : 'warning',
      },
    }),
    settings,
  );

const judgePool = (
  scenario: Scenario,
  d: Dice,
  shortage: boolean,
): SlotJudge[] => {
  const seats = scenario.events.reduce(
    (sum, e) =>
      sum +
      Math.ceil(
        e.entries /
          (e.format.outcome === 'winner'
            ? 2
            : e.format.outcome === 'ranking' && 'sides' in e.format
              ? 4
              : 6),
      ),
    0,
  );
  const count = Math.max(4, Math.ceil(seats * (shortage ? 0.8 : 1.6)) + 3);
  return Array.from({ length: count }, (_, i) => ({
    id: `judge-${i}`,
    person: `judge-person-${i}`,
    protection: d.chance(60)
      ? [{ scope: 'school', key: `school-${d.below(scenario.schools)}` }]
      : [],
    events: d.chance(15)
      ? [scenario.events[d.below(scenario.events.length)]!.id]
      : null,
    conflicts: [],
    strikes: [],
    judged: [],
    tabRoundsJudged: 0,
    outstandingBallots: 0,
    chair: d.chance(70),
    available: true,
  }));
};

const entriesFor = (plan: EventPlan, scenario: Scenario, d: Dice): Entry[] =>
  Array.from({ length: plan.entries }, (_, i) => ({
    id: `${plan.id}-entry-${String(i).padStart(2, '0')}`,
    members: [`${plan.id}-person-${i}`],
    protection: [
      { scope: 'school', key: `school-${d.below(scenario.schools)}` },
    ],
    division: plan.divisions ? (i % 3 === 0 ? 'novice' : 'open') : null,
    status: 'active',
    breakEligible: true,
  }));

const requestFor = (
  plan: EventPlan,
  state: EventState,
  tabRound: number,
  cutoff: number,
  existing: EventRequest['existing'] = [],
): EventRequest =>
  ({
    event: plan.id,
    format: plan.format,
    stage: { kind: 'preliminary' },
    tabRound,
    entries: state.entries,
    history: state.history,
    settings: plan.settings,
    cutoff,
    ratings: null,
    existing,
  }) as EventRequest;

const occupying = (
  d: Draw,
  judges: readonly SlotJudge[],
  entries: readonly Entry[],
): Commitment[] => {
  const person = new Map(judges.map((j) => [j.id, j.person]));
  const members = new Map(entries.map((e) => [e.id, e.members]));
  return [
    ...d.keep.map((k) => ({ id: k.id, fixture: k.fixture })),
    ...d.add.map((a) => ({
      id: `${d.event}-new-${a.ordinal}`,
      fixture: a.fixture,
    })),
  ].flatMap(({ id, fixture }) =>
    fixture.kind === 'bye'
      ? []
      : [
          {
            event: d.event,
            fixture: id,
            people: [
              ...(fixture.kind === 'pairing'
                ? fixture.sides
                : fixture.speakers
              ).flatMap((e) => members.get(e) ?? []),
              ...fixture.panel.map((j) => person.get(j) ?? j),
            ],
          },
        ],
  );
};

/**
 * Draws one slot's events, together or one by one, answering the engine's
 * refusals the way a host would: more judges for a short slot, a relaxed rule
 * for an infeasible one, a withdrawn entry for a collision.
 */
const drawSlot = (
  log: Log,
  label: string,
  scenario: Scenario,
  slotEvents: readonly { plan: EventPlan; state: EventState }[],
  tabRound: number,
  cutoff: number,
  judges: SlotJudge[],
  seed: Uint8Array,
): Map<Id, Draw> => {
  const out = new Map<Id, Draw>();
  const settings = new Map(
    slotEvents.map(({ plan }) => [plan.id, plan.settings]),
  );
  const groups = scenario.together ? [slotEvents] : slotEvents.map((e) => [e]);
  let commitments: Commitment[] = [];
  for (const [g, group] of groups.entries()) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const input: DrawInput = {
        call: 'slot',
        slot: label,
        events: group.map(({ plan, state }) =>
          requestFor(
            { ...plan, settings: settings.get(plan.id)! },
            state,
            tabRound,
            cutoff,
          ),
        ),
        judges,
        commitments,
        seed,
      };
      const answer = drawChecked(log, `${label}#${attempt}`, input);
      if (answer.kind === 'drawn') {
        for (const d of answer.draws) out.set(d.event, d);
        break;
      }
      if (answer.kind === 'unresolved') {
        out.set(answer.event, answer.attempt);
        if (group.length === 1) break;
        settings.set(
          answer.event,
          relax(
            settings.get(answer.event)!,
            answer.broken.map((b) => b.key),
          ),
        );
        continue;
      }
      switch (answer.cause) {
        case 'panels':
          judges.push(
            ...Array.from({ length: answer.short.length + 2 }, (_, i) => ({
              ...judges[0]!,
              id: `extra-${label}-${g}-${attempt}-${i}`,
              person: `extra-person-${label}-${g}-${attempt}-${i}`,
              protection: [],
              events: null,
              conflicts: [],
              strikes: [],
              chair: true,
              available: true,
              outstandingBallots: 0,
            })),
          );
          break;
        case 'rules':
          settings.set(
            answer.event,
            relax(settings.get(answer.event)!, answer.rules),
          );
          break;
        case 'slot':
          for (const collision of answer.collisions) {
            const holder = [...collision.holders]
              .reverse()
              .find((h) => h.kind === 'entry');
            const state =
              holder &&
              slotEvents.find((e) => e.plan.id === holder.event)?.state;
            if (state && holder?.kind === 'entry')
              state.entries = state.entries.map((e) =>
                e.id === holder.entry ? { ...e, status: 'withdrawn' } : e,
              );
          }
          break;
        case 'structure':
          return out;
      }
    }
    for (const { plan, state } of group) {
      const d = out.get(plan.id);
      if (d !== undefined && !scenario.together)
        commitments = [...commitments, ...occupying(d, judges, state.entries)];
    }
  }
  return out;
};

/** A re-draw after a drop: half the published fixtures fixed, half movable. */
const redraw = (
  log: Log,
  label: string,
  plan: EventPlan,
  state: EventState,
  d: Draw,
  tabRound: number,
  cutoff: number,
  dd: Dice,
  seed: Uint8Array,
) => {
  const published = asHistory(d, `${label}-${plan.id}`);
  const victim = state.entries.find(
    (e) => e.status === 'active' && dd.chance(20),
  );
  if (victim === undefined) return d;
  state.entries = state.entries.map((e) =>
    e.id === victim.id ? { ...e, status: 'withdrawn' } : e,
  );
  const existing = published.map((f, i) => ({
    id: f.id,
    fixture: f.fixture,
    hold:
      i % 2 === 0 &&
      !(f.fixture.kind === 'pairing' && f.fixture.sides.includes(victim.id)) &&
      !(
        f.fixture.kind === 'section' && f.fixture.speakers.includes(victim.id)
      ) &&
      !(f.fixture.kind === 'bye' && f.fixture.entry === victim.id)
        ? 'fixed'
        : 'movable',
  }));
  const input: DrawInput = {
    call: 'windowed',
    event: requestFor(
      { ...plan, settings: d.inputs.settings as ResolvedSettings },
      state,
      tabRound,
      cutoff,
      existing as never,
    ),
    judges: null,
    seed,
  };
  /** A break the host overrode when the draw was published stays overridden on the same fixture. */
  const carried: RuleBreak[] = d.assessment.broken.map((b) =>
    b.fixture.kind === 'new'
      ? {
          ...b,
          fixture: {
            kind: 'existing',
            id: `${label}-${plan.id}-${b.fixture.ordinal}`,
          },
        }
      : b,
  );
  const answer = drawChecked(log, `${label}-redraw-${plan.id}`, input, carried);
  return answer.kind === 'drawn'
    ? answer.draws[0]!
    : answer.kind === 'unresolved'
      ? answer.attempt
      : d;
};

const fixturesOfDraw = (d: Draw, prefix: string) => asHistory(d, prefix);

/** Updates the judges' records after a slot: who they judged, and ballots owed. */
const afterSlot = (
  judges: SlotJudge[],
  draws: Iterable<Draw>,
  scenario: Scenario,
  d: Dice,
) => {
  const sat = new Map<Id, Id[]>();
  for (const dr of draws)
    for (const f of [
      ...dr.keep.map((k) => k.fixture),
      ...dr.add.map((a) => a.fixture),
    ])
      if (f.kind !== 'bye')
        for (const j of f.panel)
          sat.set(j, [
            ...(sat.get(j) ?? []),
            ...(f.kind === 'pairing' ? f.sides : f.speakers),
          ]);
  judges.forEach((j, i) => {
    const seated = sat.get(j.id);
    judges[i] = {
      ...j,
      judged: [...j.judged, ...(seated ?? [])],
      tabRoundsJudged: j.tabRoundsJudged + (seated ? 1 : 0),
      outstandingBallots:
        seated && scenario.unsubmittedBallots && d.chance(10) ? 1 : 0,
      available: d.chance(92),
    };
  });
};

const standingsInput = (
  plan: EventPlan,
  state: EventState,
  cutoff: number,
  division: Id | null,
  seed: Uint8Array,
) =>
  ({
    format: plan.format,
    entries: state.entries,
    history: state.history,
    settings: plan.settings,
    cutoff,
    ratings: null,
    division,
    seed,
  }) as StandingsInput;

/** Breaks and elimination rounds for each event, every answer checked. */
const eliminations = (
  log: Log,
  scenario: Scenario,
  events: readonly { plan: EventPlan; state: EventState }[],
  judges: SlotJudge[],
  seed: Uint8Array,
  rounds: number,
) => {
  for (const { plan, state } of events) {
    const stages = plan.divisions
      ? [
          { id: `${plan.id}-open`, division: null },
          { id: `${plan.id}-novice`, division: 'novice' },
        ]
      : [{ id: `${plan.id}-open`, division: null }];
    const settings = {
      ...plan.settings,
      'break.double_qualifier': { value: scenario.doubleQualifier },
    } as ResolvedSettings;
    let choices: Record<Id, Id> = {};
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const input = {
        ...standingsInput({ ...plan, settings }, state, rounds, null, seed),
        stages,
        choices,
      } as unknown as BreaksInput;
      const answer = breaks(input);
      const verdict = checkBreaks(input, answer);
      if (!verdict.ok)
        log.rejections.push({
          where: `${plan.id}-breaks`,
          violations: verdict.violations,
        });
      if (answer.kind === 'undecided') {
        choices = {
          ...choices,
          ...Object.fromEntries(
            answer.entries.map((e) => [e.entry, e.stages[0]!]),
          ),
        };
        continue;
      }
      answer.stages.forEach((stage, s) => {
        let history: EventState['history'] = { fixtures: [], results: [] };
        const depth =
          plan.format.outcome === 'winner'
            ? Math.ceil(Math.log2(Math.max(2, stage.bracket.seeds.length)))
            : 1;
        for (let r = 1; r <= depth; r += 1) {
          const request = {
            ...requestFor(
              { ...plan, settings },
              { ...state, history },
              r,
              r - 1,
            ),
            stage: {
              kind: 'elimination',
              division: stages[s]!.division,
              bracket: stage.bracket,
            },
          } as EventRequest;
          const slotInput = {
            call: 'slot',
            slot: `${stage.stage}-r${r}`,
            events: [request],
            judges,
            commitments: [],
            seed,
          } as const;
          const first = drawChecked(log, `${stage.stage}-r${r}`, slotInput);
          const drawn =
            first.kind === 'infeasible' && first.cause === 'panels'
              ? drawChecked(log, `${stage.stage}-r${r}-unstaffed`, {
                  ...slotInput,
                  judges: null,
                })
              : first;
          if (drawn.kind !== 'drawn') break;
          const fixtures = fixturesOfDraw(
            drawn.draws[0]!,
            `${stage.stage}-r${r}`,
          );
          history = {
            fixtures: [...history.fixtures, ...fixtures],
            results: [
              ...history.results,
              ...playFixtures(
                state,
                fixtures,
                dice(seed, `${stage.stage}-${r}`),
              ),
            ],
          };
        }
      });
      break;
    }
  }
};

/**
 * Plays a whole tournament through the real engines: several events sharing
 * time slots and one judge pool, drawn together or in sequence with the
 * earlier ones as commitments, with drops, late results, judge shortages,
 * re-draws, a person in two events, unsubmitted ballots, corrections after a
 * later draw and double qualifiers. Every answer goes to the checker.
 */
export const simulate = (
  seed: Uint8Array,
  size: 'small' | 'full' = 'small',
): SimulationReport => {
  const scenario = scenarioOf(seed, size);
  const d = dice(seed, 'run');
  const log: Log = { calls: 0, answers: {}, rejections: [], kept: [] };
  const judges = judgePool(scenario, d, d.chance(25));
  const events = scenario.events.map((plan) => {
    const entries = entriesFor(plan, scenario, d);
    return {
      plan,
      state: {
        id: plan.id,
        format: plan.format as FormatDescriptor,
        entries,
        history: { fixtures: [], results: [] },
        late: [],
        strength: new Map(entries.map((e) => [e.id, d.below(60)])),
      } as EventState,
    };
  });
  if (scenario.personInTwoEvents && events.length > 1) {
    const [a, b] = [events[0]!.state, events[1]!.state];
    b.entries = b.entries.map((e, i) =>
      i === 0 ? { ...e, members: a.entries[0]!.members } : e,
    );
  }
  for (let round = 1; round <= scenario.preliminaryRounds; round += 1) {
    const live = events.filter((e) => !e.plan.windowed);
    const cutoff = scenario.lateResults && round > 2 ? round - 2 : round - 1;
    if (scenario.drops && round > 1)
      for (const { state } of events) {
        const drop = state.entries.find(
          (e) => e.status === 'active' && d.chance(8),
        );
        if (drop)
          state.entries = state.entries.map((e) =>
            e.id === drop.id ? { ...e, status: 'withdrawn' } : e,
          );
      }
    const drawn = drawSlot(
      log,
      `slot-${round}`,
      scenario,
      live,
      round,
      cutoff,
      judges,
      seed,
    );
    for (const { plan, state } of events.filter((e) => e.plan.windowed)) {
      const answer = drawChecked(log, `window-${plan.id}-${round}`, {
        call: 'windowed',
        event: requestFor(plan, state, round, round - 1),
        judges: null,
        seed,
      });
      if (answer.kind === 'drawn') drawn.set(plan.id, answer.draws[0]!);
    }
    for (const { plan, state } of events) {
      let dr = drawn.get(plan.id);
      if (dr === undefined) continue;
      if (scenario.redraws && !plan.windowed && d.chance(30))
        dr = redraw(
          log,
          `slot-${round}`,
          plan,
          state,
          dr,
          round,
          cutoff,
          d,
          seed,
        );
      log.kept.push({ digest: digestOf(canonicalJson(dr)), draw: dr });
      const fixtures = fixturesOfDraw(dr, `${plan.id}-r${round}`);
      const results = playFixtures(
        state,
        fixtures,
        dice(seed, `${plan.id}-${round}`),
      );
      const unplayed = plan.windowed ? results.filter(() => d.chance(15)) : [];
      const [now, later] = scenario.lateResults
        ? [
            results.filter((_, i) => i % 3 !== 0),
            results.filter((_, i) => i % 3 === 0),
          ]
        : [results, []];
      const corrections =
        scenario.corrections && round > 1
          ? state.history.results
              .filter((r) => r.supersedes === null && d.chance(5))
              .map(correctionOf)
          : [];
      state.history = {
        fixtures: [...state.history.fixtures, ...fixtures],
        results: [
          ...state.history.results,
          ...state.late,
          ...now.filter((r) => !unplayed.includes(r)),
          ...corrections,
        ],
      };
      state.late = later.filter((r) => !unplayed.includes(r));
      const standingsCheck = standingsInput(
        plan,
        state,
        round,
        plan.divisions && d.chance(50) ? 'novice' : null,
        seed,
      );
      const verdict = checkStandings(standingsCheck, standings(standingsCheck));
      if (!verdict.ok)
        log.rejections.push({
          where: `${plan.id}-standings-${round}`,
          violations: verdict.violations,
        });
    }
    afterSlot(judges, drawn.values(), scenario, d);
  }
  for (const { state } of events)
    state.history = {
      ...state.history,
      results: [...state.history.results, ...state.late],
    };
  eliminations(log, scenario, events, judges, seed, scenario.preliminaryRounds);
  for (const { digest, draw: kept } of log.kept)
    if (digestOf(canonicalJson(kept)) !== digest)
      log.rejections.push({
        where: 'correction',
        violations: ['an earlier draw changed'],
      });
  return {
    seed: Array.from(seed, (b) => b.toString(16).padStart(2, '0')).join(''),
    scenario,
    calls: log.calls,
    answers: log.answers,
    sharedSlots: events.filter((e) => !e.plan.windowed).length > 1,
    rejections: log.rejections,
  };
};
