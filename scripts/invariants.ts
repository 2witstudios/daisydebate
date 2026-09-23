import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { referenceFormats } from './reference-formats';
import {
  createDebateRuntime,
  debateInvariantIds,
  restoreDebateRuntime,
} from '@daisy/debate-engine';

const root = resolve(import.meta.dir, '..');
const firstId = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const secondId = 'a7b3c9d1e5f2k4m6n8p1r3t5';
const thirdId = 'c8d4e2f6a1b3k5m7n9p2r4t6';

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

const foundation = referenceFormats.find(
  (format) => format.id === 'foundation',
);
if (!foundation) throw new Error('foundation format seed missing');

const createRuntime = () =>
  createDebateRuntime({
    id: firstId,
    resolution: 'A representative resolution',
    createdAt: '2026-01-01T00:00:00.000Z',
    format: foundation.id,
    rules: foundation.rules,
  });

const createActiveRuntime = () => {
  const runtime = createRuntime();
  runtime.join({ participantId: firstId, side: 'affirmative' });
  runtime.join({ participantId: secondId, side: 'negative' });
  runtime.markReady(firstId);
  runtime.markReady(secondId);
  runtime.transition('active');
  return runtime;
};

const fixtures: Readonly<Record<string, Fixture>> = {
  'participant-identities-unique': () => {
    const participant = { id: firstId, side: 'affirmative', ready: false };
    const runtime = createRuntime();
    try {
      restoreDebateRuntime({
        ...runtime.snapshot(),
        participants: [participant, participant],
      });
    } finally {
      runtime.dispose();
    }
  },
  'participant-seats-unique': () => {
    const runtime = createRuntime();
    try {
      restoreDebateRuntime({
        ...runtime.snapshot(),
        participants: [
          { id: firstId, side: 'affirmative', ready: false },
          { id: secondId, side: 'affirmative', ready: false },
        ],
      });
    } finally {
      runtime.dispose();
    }
  },
  'active-requires-ready-participants': () =>
    createRuntime().transition('active'),
  'seats-capacity-supported': () => {
    const runtime = createRuntime();
    try {
      restoreDebateRuntime({
        ...runtime.snapshot(),
        rules: {
          ...foundation.rules,
          seats: { affirmative: 2, negative: 1, judge: 0 },
        },
      });
    } finally {
      runtime.dispose();
    }
  },
  'seats-within-format': () => {
    const runtime = createDebateRuntime({
      id: firstId,
      resolution: 'A representative resolution',
      createdAt: '2026-01-01T00:00:00.000Z',
      format: 'solo-practice',
      rules: {
        ...foundation.rules,
        seats: { affirmative: 1, negative: 0, judge: 0 },
      },
    });
    try {
      runtime.join({ participantId: firstId, side: 'negative' });
    } finally {
      runtime.dispose();
    }
  },
  'joining-requires-waiting-phase': () => {
    const runtime = createActiveRuntime();
    try {
      runtime.join({ participantId: thirdId, side: 'affirmative' });
    } finally {
      runtime.dispose();
    }
  },
  'readiness-requires-waiting-phase': () => {
    const runtime = createActiveRuntime();
    try {
      runtime.markReady(firstId);
    } finally {
      runtime.dispose();
    }
  },
  'readiness-requires-join': () => {
    const runtime = createRuntime();
    try {
      runtime.markReady(firstId);
    } finally {
      runtime.dispose();
    }
  },
  'legal-phase-transition': () => {
    const runtime = createRuntime();
    try {
      runtime.transition('completed');
    } finally {
      runtime.dispose();
    }
  },
  'completed-is-terminal': () => {
    const runtime = createActiveRuntime();
    try {
      runtime.transition('completed');
      runtime.transition('active');
    } finally {
      runtime.dispose();
    }
  },
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
