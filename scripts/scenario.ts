import { fixedIds, type IdGenerator } from '@daisy/clock';
import { referenceFormats } from '@daisy/db/reference-formats';
import {
  createRoundRuntime,
  resolveRoomConfiguration,
  type RoundCommand,
  type RoundPosition,
  type RoundRules,
} from '@daisy/debate-engine';

const foundation = referenceFormats.find(
  (format) => format.id === 'foundation',
);
if (!foundation) throw new Error('foundation format seed missing');

/** The one compiler, resolved once: the scenario's rules and seat order. */
const resolved = (() => {
  const outcome = resolveRoomConfiguration(foundation.definition, {
    preRoundPrep: { enabled: false },
    inRoundPrep: { enabled: true, budgetMsPerSide: 120_000 },
    speechTiming: { countdownMs: 10_000, segmentDurationOverrides: {} },
    crossExamination: { crossExMode: 'ordered' },
    interruptions: null,
    yielding: null,
  });
  if (!outcome.ok) throw new Error(outcome.refusal.message);
  return outcome.rules;
})();

/** The actor order the seats are held in: sides first, then the judge. */
const seatRoles = Object.entries(resolved.seats).flatMap(([role, count]) =>
  Array.from(
    { length: count },
    () => role as 'affirmative' | 'negative' | 'judge',
  ),
);

export type ScenarioAction =
  | {
      readonly type: 'command';
      readonly command: RoundCommand;
      /** The acting participant, 1-based in seat order; null acts as the service. */
      readonly actor: number | null;
    }
  | { readonly type: 'tick'; readonly atMs: number }
  | {
      readonly type: 'expect-rejection';
      readonly operation: Exclude<
        ScenarioAction,
        { readonly type: 'expect-rejection' }
      >;
      readonly invariantId: string;
    };

/**
 * The fixed identity list every foundation scenario starts from: the round
 * id, then one actor and one seat id per seat, then the ids the runtime mints
 * for each segment row it opens. Fixed cuid2 values (ADR 0018) make a run
 * byte-identical, and the shared list lives here so the five scenarios differ
 * only in what they do.
 */
export const foundationScenarioIds = [
  'k2v9x0f4m8q3w1z7c5n6b4d2',
  'a7b3c9d1e5f2k4m6n8p1r3t5',
  'c8d4e2f6a1b3k5m7n9p2r4t6',
  'd5e8f2a4c6b1k3m7n9p2r4t6',
  'f1a3b5c7d9e2f4a6b8c1d3e5',
  'a1b2c3d4e5f6a7b8c9d0e1f2',
  'e1f2a3b4c5d6e7f8a9b0c1d2',
  'b0c1d2e3f4a5b6c7d8e9f0a1',
] as const satisfies readonly [string, ...string[]];

/** What the round actually did, and what a scenario asserts against. */
export type ScenarioObservation = {
  readonly id: string;
  readonly status: 'scheduled' | 'active' | 'completed' | 'abandoned';
  readonly stage: 'countdown' | 'prep' | 'live' | null;
  /** The segment keys that opened, in order. */
  readonly opened: readonly string[];
};

export type DebateScenario = {
  readonly name: string;
  readonly given: {
    /** Round id, then the seat actors, the seat ids, then the segments. */
    readonly ids: readonly [string, ...string[]];
  };
  readonly when: readonly ScenarioAction[];
  readonly unsupported?: string;
  readonly expect: ScenarioObservation;
};

export type ScenarioExpectationReport = {
  readonly type: 'scenario-expectation-failed';
  readonly scenario: string;
  readonly step: keyof DebateScenario['expect'];
  readonly expected: unknown;
  readonly actual: unknown;
};

export class ScenarioExpectationError extends Error {
  readonly report: ScenarioExpectationReport;

  constructor(report: ScenarioExpectationReport) {
    super(
      `Scenario "${report.scenario}" failed at step "${String(report.step)}": expected ${JSON.stringify(report.expected)} but received ${JSON.stringify(report.actual)}`,
    );
    this.name = 'ScenarioExpectationError';
    this.report = report;
  }
}

type Run = {
  readonly id: string;
  /** The actor id in each seat, in seat order. */
  readonly actorIds: readonly string[];
  readonly position: (now: string) => RoundPosition;
  readonly execute: (input: {
    readonly command: RoundCommand;
    readonly actorId: string | null;
    readonly now: string;
  }) => void;
  readonly tick: (now: string) => void;
  readonly opened: () => readonly string[];
  readonly nowMs: () => number;
  readonly advanceTo: (atMs: number) => void;
};

/** One deterministic run: fixed ids, a movable clock, the real runtime. */
function startRun(scenario: DebateScenario): Run {
  const ids: IdGenerator = fixedIds(scenario.given.ids);
  const id = ids.next();
  const actorIds = seatRoles.map(() => ids.next());
  const runtime = createRoundRuntime({
    round: {
      id,
      status: 'scheduled',
      currentStage: null,
      startedAt: null,
      completedAt: null,
      outcome: null,
    },
    rules: resolved as RoundRules,
    participants: seatRoles.map((role, index) => ({
      id: ids.next(),
      actorId: actorIds[index]!,
      role,
      slot: 0,
    })),
    checkpoint: {
      version: 1,
      prep_consumed_ms: { affirmative: 0, negative: 0 },
      active_prep: null,
      floor: null,
    },
    segments: [],
    nextSegmentId: () => ids.next(),
  });
  const opened: string[] = [];
  let atMs = 0;
  const collect = (writes: {
    segmentInserts: readonly { rulesSegmentKey: string }[];
  }) => {
    for (const insert of writes.segmentInserts)
      opened.push(insert.rulesSegmentKey);
  };
  return {
    id,
    actorIds,
    position: (now) => runtime.position(now),
    execute: (input) => collect(runtime.execute(input)),
    tick: (now) => collect(runtime.tick(now)),
    opened: () => opened,
    nowMs: () => atMs,
    advanceTo: (target) => {
      atMs = target;
    },
  };
}

export function runScenario(scenario: DebateScenario): ScenarioObservation {
  if (scenario.unsupported !== undefined)
    throw new Error(
      `Scenario "${scenario.name}" is unsupported: ${scenario.unsupported}`,
    );
  const run = startRun(scenario);
  const apply = (
    action: Exclude<ScenarioAction, { readonly type: 'expect-rejection' }>,
  ) => {
    if (action.type === 'tick') {
      run.advanceTo(action.atMs);
      run.tick(new Date(action.atMs).toISOString());
      return;
    }
    const actor = action.actor === null ? null : seatActor(run, action.actor);
    run.execute({
      command: action.command,
      actorId: actor,
      now: new Date(run.nowMs()).toISOString(),
    });
  };
  scenario.when.forEach((action) => {
    if (action.type === 'expect-rejection') {
      const before = JSON.stringify(run.opened());
      let error: unknown;
      try {
        apply(action.operation);
      } catch (caught) {
        error = caught;
      }
      if (
        error === undefined ||
        invariantId(error) !== action.invariantId ||
        JSON.stringify(run.opened()) !== before
      )
        throw new Error(
          `Scenario "${scenario.name}" expected atomic rejection with invariant "${action.invariantId}"`,
        );
    } else apply(action);
  });
  return assertScenario(scenario, run);
}

/** The actor id in seat order; the acting participant is 1-based. */
function seatActor(run: Run, actor: number): string {
  const id = run.actorIds[actor - 1];
  if (id === undefined)
    throw new Error(`Scenario actor index ${actor} is not configured`);
  return id;
}

function invariantId(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object' || !('invariantId' in error))
    return undefined;
  const value = (error as { invariantId?: unknown }).invariantId;
  return typeof value === 'string' ? value : undefined;
}

function assertScenario(
  scenario: DebateScenario,
  run: Run,
): ScenarioObservation {
  const expected = scenario.expect;
  const position = run.position(new Date(run.nowMs()).toISOString());
  const actual: ScenarioObservation = {
    id: run.id,
    status: position.status,
    stage: position.stage,
    opened: run.opened(),
  };
  const step = (['id', 'status', 'stage', 'opened'] as const).find(
    (candidate) =>
      JSON.stringify(expected[candidate]) !== JSON.stringify(actual[candidate]),
  );
  if (step !== undefined)
    throw new ScenarioExpectationError({
      type: 'scenario-expectation-failed',
      scenario: scenario.name,
      step,
      expected: expected[step],
      actual: actual[step],
    });
  return actual;
}

async function loadScenario(name: string): Promise<DebateScenario> {
  if (!/^[a-z0-9-]+$/.test(name))
    throw new Error(
      'Scenario names may contain only lowercase letters, numbers, and hyphens',
    );
  const module = await import(`../scenarios/${name}.ts`);
  return module.default as DebateScenario;
}

if (import.meta.main) {
  const name = Bun.argv[2];
  if (!name) throw new Error('Usage: bun scenario <name>');
  try {
    const scenario = await loadScenario(name);
    if (scenario.unsupported !== undefined) {
      console.log(`Scenario boundary documented: ${name}`);
    } else {
      runScenario(scenario);
      console.log(`Scenario passed: ${name}`);
    }
  } catch (error) {
    console.error(
      error instanceof ScenarioExpectationError
        ? JSON.stringify(error.report)
        : error instanceof Error
          ? error.message
          : error,
    );
    process.exitCode = 1;
  }
}
