import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '@daisy/db/reference-formats';
import {
  createRoundRuntime,
  debateInvariantIds,
  rateDebate,
  ratePeriod,
  resolveRoomConfiguration,
} from '@daisy/debate-engine';
import type {
  HydratedSegment,
  RoundParticipantSeat,
  RoundRules,
  RoundStatus,
  RuntimeCheckpoint,
} from '@daisy/protocol';

const root = resolve(import.meta.dir, '..');
const t0 = '2026-01-01T00:00:00.000Z';
const roundId = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const person = 'a7b3c9d1e5f2k4m6n8p1r3t5';
const opponent = 'c8d4e2f6a1b3k5m7n9p2r4t6';
const judge = 'd5e8f2a4c6b1k3m7n9p2r4t6';

/** The one-on-one practice rules the fixtures drive; throws when refused. */
const rules = (config = practiceRoomConfig): RoundRules => {
  const outcome = resolveRoomConfiguration(oneOnOneDefinition, config);
  if (!outcome.ok) throw new Error(outcome.refusal.message);
  return outcome.rules;
};

const seats: readonly RoundParticipantSeat[] = [
  {
    id: 'm3w8k1z5c9b2n7p4r6t0v2x4',
    actorId: person,
    role: 'affirmative',
    slot: 0,
  },
  {
    id: 'q5x2v8t0r4p6n2b8c1z7k3m9w',
    actorId: opponent,
    role: 'negative',
    slot: 0,
  },
  { id: 'd6y3h9j1f5a7s3g8l2q6e4u0i', actorId: judge, role: 'judge', slot: 0 },
];

const freshCheckpoint: RuntimeCheckpoint = {
  version: 1,
  prep_consumed_ms: { affirmative: 0, negative: 0 },
  active_prep: null,
  floor: null,
};

/** The AC, closed, so the fixture stands where the AC's own speaker does. */
const closedAc: readonly HydratedSegment[] = [
  {
    id: 'segment-1',
    sequence: 0,
    type: 'speech',
    rulesSegmentKey: 'AC',
    startedAt: t0,
    endedAt: '2026-01-01T00:05:00.000Z',
    durationMs: 300_000,
  },
];

/** One runtime, driven only as far as the fixture needs. */
const round = (input: {
  readonly status?: RoundStatus;
  readonly segments?: readonly HydratedSegment[];
  readonly checkpoint?: unknown;
  readonly participants?: readonly RoundParticipantSeat[];
  readonly rules?: RoundRules;
}) =>
  createRoundRuntime({
    round: {
      id: roundId,
      status: input.status ?? 'scheduled',
      currentStage: null,
      startedAt: input.status === 'active' ? t0 : null,
      completedAt: null,
      outcome: null,
    },
    rules: input.rules ?? rules(),
    participants: input.participants ?? seats,
    checkpoint: input.checkpoint ?? freshCheckpoint,
    segments: input.segments ?? [],
    nextSegmentId: () => 'segment-fixture',
  });

export type InvariantSpecEntry = {
  readonly id: string;
  readonly check: string;
  readonly testReference: {
    readonly path: string;
    readonly name: string;
  };
};

export type InvariantSpec = {
  readonly version: number;
  readonly invariants: readonly InvariantSpecEntry[];
};

export type InvariantResult = {
  readonly id: string;
  readonly status: 'pass' | 'fail';
  readonly detail: string;
};

export type InvariantReport = {
  readonly ok: boolean;
  readonly issues: readonly string[];
  readonly results: readonly InvariantResult[];
};

type Fixture = () => void;
type TestSources = Readonly<Record<string, string>>;

const fixtures: Readonly<Record<string, Fixture>> = {
  'completed-is-terminal': () =>
    round({ status: 'completed' }).execute({
      command: { type: 'start' },
      actorId: null,
      now: t0,
    }),
  'segment-matches-rules': () =>
    round({
      status: 'active',
      segments: [{ ...closedAc[0]!, durationMs: 299_000 }],
    }),
  'live-open-segment-count': () =>
    round({
      status: 'active',
      segments: [
        { ...closedAc[0]!, endedAt: null },
        {
          id: 'segment-2',
          sequence: 1,
          type: 'cross_ex',
          rulesSegmentKey: 'CX1',
          startedAt: '2026-01-01T00:05:00.000Z',
          endedAt: null,
          durationMs: 120_000,
        },
      ],
    }),
  'seats-complete': () =>
    round({
      participants: [seats[0]!, seats[2]!],
    }).execute({ command: { type: 'start' }, actorId: null, now: t0 }),
  'prep-requires-capability': () =>
    round({
      status: 'active',
      rules: rules({ ...practiceRoomConfig, inRoundPrep: { enabled: false } }),
    }).execute({
      command: { type: 'start_prep' },
      actorId: person,
      now: t0,
    }),
  'prep-requires-spendable-segment': () =>
    round({ status: 'active', segments: closedAc }).execute({
      command: { type: 'start_prep' },
      actorId: opponent,
      now: t0,
    }),
  'prep-requires-budget': () =>
    round({
      status: 'active',
      checkpoint: {
        version: 1,
        prep_consumed_ms: { affirmative: 240_000, negative: 0 },
        active_prep: null,
        floor: null,
      },
    }).execute({
      command: { type: 'start_prep' },
      actorId: person,
      now: t0,
    }),
  'speech-requires-prep': () =>
    round({ status: 'active' }).execute({
      command: { type: 'start_speech' },
      actorId: person,
      now: t0,
    }),
  'yield-requires-floor': () =>
    round({ status: 'active' }).execute({
      command: { type: 'yield' },
      actorId: person,
      now: t0,
    }),
  'interrupt-requires-policy': () =>
    round({ status: 'active' }).execute({
      command: { type: 'interrupt' },
      actorId: opponent,
      now: t0,
    }),
  'complete-after-final-segment': () =>
    round({ status: 'active' }).execute({
      command: { type: 'complete', outcome: 'affirmative' },
      actorId: null,
      now: t0,
    }),
  'rating-state-bounded': () =>
    rateDebate({
      affirmative: {
        state: { rating: 1500, deviation: 0, volatility: 0.06 },
        lastRatedAt: null,
      },
      negative: {
        state: { rating: 1500, deviation: 350, volatility: 0.06 },
        lastRatedAt: null,
      },
      outcome: 'draw',
      occurredAt: t0,
    }),
  'rating-volatility-converges': () =>
    ratePeriod(
      { rating: 1500, deviation: 200, volatility: 0.06 },
      [{ opponent: { rating: 1700, deviation: 300 }, score: 1 }],
      { tau: 0.5, epsilon: 1e-6, maxIterations: 0 },
    ),
};

const registryIds = Object.values(debateInvariantIds);

function invariantId(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object' || !('invariantId' in error))
    return undefined;
  const value = (error as { invariantId?: unknown }).invariantId;
  return typeof value === 'string' ? value : undefined;
}

export function checkInvariantSpec(
  spec: InvariantSpec,
  registeredIds: readonly string[] = registryIds,
  sources: TestSources = {},
): readonly string[] {
  const specIds = spec.invariants.map(({ id }) => id);
  const issues = [
    ...(spec.version === 1
      ? []
      : [`spec: unsupported version ${spec.version}`]),
    ...specIds
      .filter((id, index) => specIds.indexOf(id) !== index)
      .map((id) => `spec: duplicate invariant entry ${id}`),
    ...registeredIds
      .filter((id) => !specIds.includes(id))
      .map((id) => `registry: missing spec entry for ${id}`),
    ...specIds
      .filter((id) => !registeredIds.includes(id))
      .map((id) => `registry: unknown spec entry ${id}`),
    ...spec.invariants
      .filter(({ check }) => fixtures[check] === undefined)
      .map(({ check }) => `check: ${check} has no registered fixture`),
    ...spec.invariants.flatMap(({ id, testReference }) => {
      const source = sources[testReference.path];
      return source === undefined
        ? [`test-reference: ${testReference.path} is unavailable`]
        : [
            ...(source.includes(testReference.name)
              ? []
              : [
                  `test-reference: ${testReference.name} is absent from ${testReference.path}`,
                ]),
            ...(source.includes(id)
              ? []
              : [`test-reference: ${id} is absent from ${testReference.path}`]),
          ];
    }),
  ];
  return [...new Set(issues)].sort();
}

function runFixture(entry: InvariantSpecEntry): InvariantResult {
  const fixture = fixtures[entry.check];
  if (fixture === undefined)
    return { id: entry.id, status: 'fail', detail: 'fixture unavailable' };
  try {
    fixture();
    return {
      id: entry.id,
      status: 'fail',
      detail: 'fixture completed without an invariant violation',
    };
  } catch (error) {
    const actual = invariantId(error);
    return actual === entry.id
      ? { id: entry.id, status: 'pass', detail: entry.check }
      : {
          id: entry.id,
          status: 'fail',
          detail: `expected ${entry.id}, got ${actual ?? 'no invariant ID'}`,
        };
  }
}

export function runInvariantChecks(
  spec: InvariantSpec,
  registered = registryIds,
): InvariantReport {
  const results = registered.map((id) => {
    const entry = spec.invariants.find((candidate) => candidate.id === id);
    return entry === undefined
      ? {
          id,
          status: 'fail' as const,
          detail: 'missing spec entry',
        }
      : runFixture(entry);
  });
  return {
    ok: results.every(({ status }) => status === 'pass'),
    issues: [],
    results,
  };
}

export function formatInvariantReport(
  report: InvariantReport,
  json: boolean,
): string {
  if (json) return `${JSON.stringify(report, null, 2)}\n`;
  return [
    `Daisy invariants: ${report.ok ? 'PASS' : 'FAIL'}`,
    ...report.issues.map((issue) => `FAIL ${issue}`),
    ...report.results.map(
      ({ id, status, detail }) =>
        `${status === 'pass' ? 'PASS' : 'FAIL'} ${id}: ${detail}`,
    ),
    '',
  ].join('\n');
}

async function readSpec(): Promise<InvariantSpec> {
  return JSON.parse(
    await readFile(resolve(root, 'spec/invariants.json'), 'utf8'),
  ) as InvariantSpec;
}

async function readTestSources(spec: InvariantSpec): Promise<TestSources> {
  const paths = [
    ...new Set(spec.invariants.map(({ testReference }) => testReference.path)),
  ];
  const entries = await Promise.all(
    paths.map(
      async (path) =>
        [path, await readFile(resolve(root, path), 'utf8')] as const,
    ),
  );
  return Object.fromEntries(entries);
}

if (import.meta.main) {
  try {
    const spec = await readSpec();
    const sources = await readTestSources(spec);
    const issues = checkInvariantSpec(spec, registryIds, sources);
    const checks = runInvariantChecks(spec);
    const report = {
      ...checks,
      ok: issues.length === 0 && checks.ok,
      issues,
    };
    process.stdout.write(
      formatInvariantReport(report, Bun.argv.includes('--json')),
    );
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const report: InvariantReport = {
      ok: false,
      issues: [error instanceof Error ? error.message : 'unable to load spec'],
      results: [],
    };
    process.stdout.write(
      formatInvariantReport(report, Bun.argv.includes('--json')),
    );
    process.exitCode = 1;
  }
}
