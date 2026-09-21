import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import {
  composeReconcileMessage,
  expectedEvents,
  findMissingRuns,
  pullRequestsFromSlurp,
  readRunRecords,
  selectReconcilableMerges,
  type MergedPullRequest,
} from './docs-reconcile';
import type { DocumentationRunRecord } from './docs-contracts';
import { RUN_RECORD_COLUMNS } from './docs-runs-sheet';

setupRitewayBun();

const REPOSITORY = '2witstudios/daisydebate';

const mergedPullRequest = (
  overrides: Partial<MergedPullRequest> = {},
): MergedPullRequest => ({
  id: 1001,
  number: 7,
  title: 'feat(protocol): add the tournament envelope',
  body: null,
  url: `https://github.com/${REPOSITORY}/pull/7`,
  author: '2witstudios',
  mergedBy: '2witstudios',
  repository: REPOSITORY,
  baseRef: 'main',
  baseSha: 'base000',
  mergeCommitSha: 'merge007',
  mergedAt: '2026-09-20T00:00:00.000Z',
  fork: false,
  changedFiles: ['packages/protocol/src/events.ts'],
  ...overrides,
});

const runRecord = (
  overrides: Partial<DocumentationRunRecord> = {},
): DocumentationRunRecord => ({
  runId: 'run-1',
  workflow: 'technical-docs',
  startedAt: '2026-09-20T00:05:00.000Z',
  completedAt: '2026-09-20T00:06:00.000Z',
  scope: { pageIds: [], changedSince: '2026-09-20T00:00:00.000Z' },
  pagesReviewed: 1,
  findings: [],
  autoFixed: 0,
  tasksCreated: 0,
  pagesInvalidated: 0,
  promptVersion: 'docs-prompt-v1',
  sourceSnapshot: `${REPOSITORY}@merge007`,
  status: 'complete',
  ...overrides,
});

describe('expectedEvents', async () => {
  test('recomputes the event the merge workflow should have dispatched', async () => {
    const [event] = expectedEvents([mergedPullRequest()]);
    assert({
      given: 'a merged non-fork pull request touching a protocol package',
      should: 'rebuild the same envelope the merge dispatch would have sent',
      actual: {
        idempotencyKey: event?.idempotencyKey,
        commit: event?.commit,
        pipelines: [...(event?.classification.pipelines ?? [])].sort(),
      },
      expected: {
        idempotencyKey: `${REPOSITORY}:merge007:pull_request.merged`,
        commit: 'merge007',
        pipelines: ['technical-docs', 'user-docs'],
      },
    });
  });

  test('excludes fork merges, which carry no secrets and never dispatch', async () => {
    assert({
      given: 'a merged fork pull request',
      should: 'expect no documentation event',
      actual: expectedEvents([mergedPullRequest({ fork: true })]).length,
      expected: 0,
    });
  });

  test('excludes merges the classifier treats as a no-op', async () => {
    assert({
      given: 'a test-only merge that selects no pipelines',
      should: 'expect no documentation event',
      actual: expectedEvents([
        mergedPullRequest({
          title: 'test: cover the rejection paths',
          changedFiles: ['packages/protocol/src/events.test.ts'],
        }),
      ]).length,
      expected: 0,
    });
  });

  test('classifies the sanitized text the dispatcher would have sent', async () => {
    const longBody = `${'padding '.repeat(2000)}breaking change`;
    const [event] = expectedEvents([
      mergedPullRequest({ title: 'chore: tidy imports', body: longBody }),
    ]);
    assert({
      given: 'a body whose keyword falls past the dispatcher field limit',
      should: 'classify on the truncated text, as the dispatcher does',
      actual: event?.classification.changeKind ?? 'no-event',
      expected: 'refactor',
    });
  });
});

describe('selectReconcilableMerges', async () => {
  const now = new Date('2026-09-20T12:00:00.000Z').getTime();
  const hours = (count: number) => count * 60 * 60 * 1000;

  test('ignores merges younger than the grace period', async () => {
    assert({
      given: 'a merge from ten minutes ago and an hour of grace',
      should: 'leave it for the agent to finish rather than report it missing',
      actual: selectReconcilableMerges({
        pullRequests: [
          mergedPullRequest({ mergedAt: '2026-09-20T11:50:00.000Z' }),
        ],
        now,
        sinceMs: hours(24),
        graceMs: hours(1),
      }).length,
      expected: 0,
    });
  });

  test('keeps merges inside the lookback window', async () => {
    assert({
      given: 'merges at eight hours and at thirty hours old',
      should: 'keep only the one inside a twenty-four hour lookback',
      actual: selectReconcilableMerges({
        pullRequests: [
          mergedPullRequest({
            number: 8,
            mergedAt: '2026-09-20T04:00:00.000Z',
          }),
          mergedPullRequest({
            number: 6,
            mergedAt: '2026-09-19T06:00:00.000Z',
          }),
        ],
        now,
        sinceMs: hours(24),
        graceMs: hours(1),
      }).map((pullRequest) => pullRequest.number),
      expected: [8],
    });
  });
});

describe('findMissingRuns', async () => {
  test('treats a run record as covering only its own workflow', async () => {
    assert({
      given:
        'a merge routed to technical and user docs with only a technical run',
      should: 'report the user-docs pipeline as uncovered',
      actual: findMissingRuns({
        expected: expectedEvents([mergedPullRequest()]),
        runRecords: [runRecord({ workflow: 'technical-docs' })],
      }).map(({ pipeline }) => pipeline),
      expected: ['user-docs'],
    });
  });

  test('accepts a merge whose every routed pipeline wrote a record', async () => {
    assert({
      given: 'run records for both routed pipelines at the merge snapshot',
      should: 'report nothing uncovered',
      actual: findMissingRuns({
        expected: expectedEvents([mergedPullRequest()]),
        runRecords: [
          runRecord({ workflow: 'technical-docs' }),
          runRecord({ runId: 'run-2', workflow: 'user-docs' }),
        ],
      }).length,
      expected: 0,
    });
  });

  test('does not let a record from another commit cover the merge', async () => {
    assert({
      given: 'run records whose sourceSnapshot names a different commit',
      should: 'report both routed pipelines as uncovered',
      actual: findMissingRuns({
        expected: expectedEvents([mergedPullRequest()]),
        runRecords: [
          runRecord({ sourceSnapshot: `${REPOSITORY}@other99` }),
          runRecord({
            runId: 'run-2',
            workflow: 'user-docs',
            sourceSnapshot: `${REPOSITORY}@other99`,
          }),
        ],
      }).map(({ pipeline }) => pipeline),
      expected: ['technical-docs', 'user-docs'],
    });
  });

  test('does not let a failed run stand in for a receipt', async () => {
    assert({
      given: 'a technical-docs record whose status is failed',
      should: 'still report technical-docs as uncovered',
      actual: findMissingRuns({
        expected: expectedEvents([mergedPullRequest()]),
        runRecords: [
          runRecord({ status: 'failed' }),
          runRecord({ runId: 'run-2', workflow: 'user-docs' }),
        ],
      }).map(({ pipeline }) => pipeline),
      expected: ['technical-docs'],
    });
  });
});

describe('composeReconcileMessage', async () => {
  test('names each uncovered pipeline with its merge', async () => {
    const actual = composeReconcileMessage(
      findMissingRuns({
        expected: expectedEvents([mergedPullRequest()]),
        runRecords: [runRecord({ workflow: 'technical-docs' })],
      }),
    );
    assert({
      given: 'one uncovered pipeline',
      should: 'lead with the count and name the pull request and pipeline',
      actual: {
        leads: actual.startsWith('🔴 Documentation freshness: 1 uncovered'),
        namesPullRequest: actual.includes('#7'),
        namesPipeline: actual.includes('user-docs'),
        namesSnapshot: actual.includes(`${REPOSITORY}@merge007`),
      },
      expected: {
        leads: true,
        namesPullRequest: true,
        namesPipeline: true,
        namesSnapshot: true,
      },
    });
  });
});

describe('pullRequestsFromSlurp', async () => {
  test('flattens every page gh --paginate --slurp returns', async () => {
    assert({
      given: 'two pages of pull requests wrapped in one outer array',
      should: 'return the pull requests of every page, in order',
      actual: pullRequestsFromSlurp(
        JSON.stringify([[{ number: 3 }, { number: 2 }], [{ number: 1 }]]),
      ).map((pullRequest) => pullRequest.number),
      expected: [3, 2, 1],
    });
  });
});

describe('readRunRecords', async () => {
  const cell = (raw: string) => ({ raw, value: raw });
  const header = {
    rowIndex: 0,
    cells: Object.fromEntries(
      RUN_RECORD_COLUMNS.map(({ column, field }) => [column, cell(field)]),
    ),
  };
  const row = (rowIndex: number, runId: string) => ({
    rowIndex,
    cells: {
      A: cell(runId),
      B: cell('technical-docs'),
      C: cell('2026-09-21T03:50:00Z'),
      D: cell('2026-09-21T03:56:00Z'),
      E: cell('complete'),
      F: cell(`${REPOSITORY}@merge007`),
      G: cell('docs-prompt-v1'),
      I: cell('{"pageIds":[],"changedSince":"2026-09-21T03:40:00Z"}'),
      J: cell('0'),
      K: cell('[]'),
      L: cell('0'),
      M: cell('0'),
      N: cell('0'),
    },
  });

  test('pages through the Runs sheet with the bearer token', async () => {
    const requests: { body: Record<string, unknown>; auth: string | null }[] =
      [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({
        body,
        auth: new Headers(init?.headers).get('Authorization'),
      });
      const first = body.fromRow === 0;
      return new Response(
        JSON.stringify({
          rows: first ? [header, row(1, 'dabc')] : [row(2, 'ddef')],
          hasMore: first,
          nextFromRow: first ? 2 : null,
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const records = await readRunRecords({
      token: 'tok',
      apiUrl: 'https://pagespace.test',
      fetchImpl,
    });
    assert({
      given: 'a sheet that answers in two pages',
      should: 'follow nextFromRow and return every record, authenticated',
      actual: {
        runIds: records.map((record) => record.runId),
        fromRows: requests.map((request) => request.body.fromRow),
        auth: requests.map((request) => request.auth),
      },
      expected: {
        runIds: ['dabc', 'ddef'],
        fromRows: [0, 2],
        auth: ['Bearer tok', 'Bearer tok'],
      },
    });
  });

  test('fails loudly when PageSpace refuses the read', async () => {
    const fetchImpl = (async () =>
      new Response('{"error":"forbidden"}', {
        status: 403,
      })) as unknown as typeof fetch;
    let message = 'no throw';
    try {
      await readRunRecords({
        token: 'tok',
        apiUrl: 'https://pagespace.test',
        fetchImpl,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    assert({
      given: 'a 403 from the sheets route',
      should: 'throw rather than reconcile against no records',
      actual: message,
      expected:
        'Reading Documentation Runs responded 403: {"error":"forbidden"}',
    });
  });

  const readWith = async (pages: readonly unknown[]) => {
    let call = 0;
    const fetchImpl = (async () =>
      new Response(JSON.stringify(pages[call++] ?? pages.at(-1)), {
        status: 200,
      })) as unknown as typeof fetch;
    try {
      await readRunRecords({
        token: 'tok',
        apiUrl: 'https://pagespace.test',
        fetchImpl,
      });
      return 'no throw';
    } catch (error) {
      return (error as Error).message;
    }
  };

  test('refuses a page without a usable pagination envelope', async () => {
    assert({
      given: 'a 200 page with no hasMore flag',
      should: 'throw rather than treat one page as the whole sheet',
      actual: (await readWith([{ rows: [header] }])).startsWith(
        'Reading Documentation Runs returned an invalid page',
      ),
      expected: true,
    });
  });

  test('refuses a cursor that does not advance', async () => {
    assert({
      given: 'a page that promises more rows but points back at itself',
      should: 'throw rather than request the same page forever',
      actual: (
        await readWith([{ rows: [header], hasMore: true, nextFromRow: 0 }])
      ).startsWith('Reading Documentation Runs returned an invalid page'),
      expected: true,
    });
  });
});
