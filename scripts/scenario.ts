import { fixedClock, fixedIds } from '@daisy/clock';
import {
  createDebateRuntime,
  type DebatePhase,
  type Participant,
  type DebateSnapshot,
} from '@daisy/debate-engine';

export type ScenarioAction =
  | {
      readonly type: 'join';
      readonly participant: number;
      readonly side: Participant['side'];
    }
  | { readonly type: 'ready'; readonly participant: number }
  | { readonly type: 'transition'; readonly phase: DebatePhase };

export type DebateScenario = {
  readonly name: string;
  readonly given: {
    readonly clock: string;
    readonly ids: readonly [string, ...string[]];
    readonly resolution: string;
  };
  readonly when: readonly ScenarioAction[];
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
  const { given } = scenario;
  const ids = fixedIds(given.ids);
  const debateId = ids.next();
  const participantIds = given.ids.slice(1).map(() => ids.next());
  const runtime = createDebateRuntime({
    id: debateId,
    resolution: given.resolution,
    createdAt: fixedClock(given.clock).now(),
  });

  try {
    scenario.when.forEach((action) => {
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
    });

    const snapshot = runtime.snapshot();
    assertScenario(scenario, snapshot);
    return snapshot;
  } finally {
    runtime.dispose();
  }
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
    runScenario(await loadScenario(name));
    console.log(`Scenario passed: ${name}`);
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
