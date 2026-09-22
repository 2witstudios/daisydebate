import { fixedClock, fixedIds } from '@daisy/clock';
import { formatSeeds } from './format-seed';
import {
  createDebateRuntime,
  type DebatePhase,
  type Participant,
  type DebateSnapshot,
} from '@daisy/debate-engine';

const foundation = formatSeeds.find((format) => format.id === 'foundation');
if (!foundation) throw new Error('foundation format seed missing');

export type ScenarioAction =
  | {
      readonly type: 'join';
      readonly participant: number;
      readonly side: Participant['side'];
    }
  | { readonly type: 'ready'; readonly participant: number }
  | { readonly type: 'transition'; readonly phase: DebatePhase }
  | {
      readonly type: 'expect-rejection';
      readonly operation: Exclude<
        ScenarioAction,
        { readonly type: 'expect-rejection' }
      >;
      readonly invariantId: string;
    };

export type DebateScenario = {
  readonly name: string;
  readonly given: {
    readonly clock: string;
    readonly ids: readonly [string, ...string[]];
    readonly resolution: string;
  };
  readonly when: readonly ScenarioAction[];
  readonly unsupported?: string;
  readonly expect: {
    readonly id: string;
    readonly createdAt: string;
    readonly phase: DebatePhase;
    readonly participantIds: readonly string[];
  };
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

export function runScenario(scenario: DebateScenario): DebateSnapshot {
  if (scenario.unsupported !== undefined)
    throw new Error(
      `Scenario "${scenario.name}" is unsupported: ${scenario.unsupported}`,
    );
  const { given } = scenario;
  const ids = fixedIds(given.ids);
  const debateId = ids.next();
  const participantIds = given.ids.slice(1).map(() => ids.next());
  const runtime = createDebateRuntime({
    id: debateId,
    resolution: given.resolution,
    createdAt: fixedClock(given.clock).now(),
    format: foundation.id,
    rules: foundation.rules,
  });

  try {
    scenario.when.forEach((action) => {
      if (action.type === 'expect-rejection') {
        const before = runtime.snapshot();
        let error: unknown;
        try {
          applyAction(runtime, action.operation, participantIds);
        } catch (caught) {
          error = caught;
        }
        if (
          error === undefined ||
          invariantId(error) !== action.invariantId ||
          JSON.stringify(runtime.snapshot()) !== JSON.stringify(before)
        )
          throw new Error(
            `Scenario "${scenario.name}" expected atomic rejection with invariant "${action.invariantId}"`,
          );
      } else applyAction(runtime, action, participantIds);
    });

    const snapshot = runtime.snapshot();
    assertScenario(scenario, snapshot);
    return snapshot;
  } finally {
    runtime.dispose();
  }
}

function applyAction(
  runtime: ReturnType<typeof createDebateRuntime>,
  action: Exclude<ScenarioAction, { readonly type: 'expect-rejection' }>,
  participantIds: readonly string[],
): void {
  if (action.type === 'join') {
    runtime.join({
      participantId:
        participantIds[action.participant - 1] ??
        failParticipant(action.participant),
      side: action.side,
    });
  } else if (action.type === 'ready') {
    runtime.markReady(
      participantIds[action.participant - 1] ??
        failParticipant(action.participant),
    );
  } else runtime.transition(action.phase);
}

function invariantId(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object' || !('invariantId' in error))
    return undefined;
  const value = (error as { invariantId?: unknown }).invariantId;
  return typeof value === 'string' ? value : undefined;
}

function failParticipant(index: number): never {
  throw new Error(`Scenario participant index ${index} is not configured`);
}

function assertScenario(
  scenario: DebateScenario,
  snapshot: DebateSnapshot,
): void {
  const expected = scenario.expect;
  const actual = {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    phase: snapshot.phase,
    participantIds: snapshot.participants.map(({ id }) => id),
  };
  const step = (['id', 'createdAt', 'phase', 'participantIds'] as const).find(
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
