import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  debtIssue,
  findTaskPages,
  mergedTarget,
  needsDebt,
  reviewedCodes,
  staleLeaves,
  type BoardTask,
} from './board-state';

setupRitewayBun();

const tree = [
  {
    id: 'tasks',
    type: 'TASK_LIST',
    title: 'Tasks',
    children: [
      {
        id: 'phase',
        type: 'TASK_LIST',
        title: 'Phase — Realtime',
        children: [
          { id: 'p1', type: 'TASK_LIST', title: 'RT-2.2 — Given x, should y' },
          { id: 'p2', type: 'TASK_LIST', title: 'RT-2.2f — Given a, should b' },
          { id: 'p3', type: 'DOCUMENT', title: 'RT-2.2 — notes' },
        ],
      },
    ],
  },
];

describe('findTaskPages', () => {
  test('maps task codes to task pages and their lists', () => {
    assert({
      given: 'a drive tree with a leaf, its suffixed follow-up and a document',
      should: 'return task-list pages whose title starts with the code',
      actual: findTaskPages(tree),
      expected: [
        { code: 'RT-2.2', pageId: 'p1', listId: 'phase' },
        { code: 'RT-2.2f', pageId: 'p2', listId: 'phase' },
      ],
    });
  });
});

describe('mergedTarget', () => {
  test('moves open tasks to merged and never regresses Done', () => {
    assert({
      given: 'each status a merged task can be in',
      should: 'target merged unless already merged or Done',
      actual: [
        'pending',
        'ready',
        'in_progress',
        'blocked',
        'in_review',
        'merged',
        'completed',
      ].map(mergedTarget),
      expected: [
        'merged',
        'merged',
        'merged',
        'merged',
        'merged',
        undefined,
        undefined,
      ],
    });
  });
});

describe('needsDebt', () => {
  const cutoff = '2026-09-23T00:00:00Z';

  test('records debt only after the cutoff and without a review-record status', () => {
    assert({
      given: 'merges before and after the cutoff, with and without the status',
      should: 'need debt only for an unreviewed merge after the cutoff',
      actual: [
        needsDebt({
          mergedAt: '2026-09-24T00:00:00Z',
          cutoff,
          reviewState: undefined,
        }),
        needsDebt({
          mergedAt: '2026-09-24T00:00:00Z',
          cutoff,
          reviewState: 'failure',
        }),
        needsDebt({
          mergedAt: '2026-09-24T00:00:00Z',
          cutoff,
          reviewState: 'success',
        }),
        needsDebt({
          mergedAt: '2026-09-22T00:00:00Z',
          cutoff,
          reviewState: undefined,
        }),
        needsDebt({
          mergedAt: '2026-09-24T00:00:00Z',
          cutoff: null,
          reviewState: undefined,
        }),
      ],
      expected: [true, true, false, false, false],
    });
  });
});

describe('debtIssue', () => {
  test('writes an ISSUE-n body with origin, why and criteria', () => {
    const issue = debtIssue({
      pr: 61,
      title: 'feat(x): y (RT-4.1)',
      url: 'https://github.com/o/r/pull/61',
      headSha: 'c'.repeat(40),
      codes: ['RT-4.1'],
    });
    assert({
      given: 'a merged PR with no review-record status',
      should: 'name the PR, SHA and tasks and ask for a post-merge review',
      actual: [
        issue.title,
        issue.criteria.length,
        issue.criteria[0]?.includes('cccccccccccc'),
      ],
      expected: [
        'Given PR #61 merged without a review record, should get a post-merge independent review of cccccccccccc',
        2,
        true,
      ],
    });
  });
});

describe('staleLeaves', () => {
  const task = (overrides: Partial<BoardTask>): BoardTask => ({
    code: 'RT-1.1',
    pageId: 'p',
    listId: 'l',
    taskId: 't',
    status: 'in_progress',
    hasReviewRecord: false,
    ...overrides,
  });

  test('lists tasks whose status disagrees with git and their pre-Done fix', () => {
    const merged = new Set(['RT-1.1', 'RT-1.2', 'RT-1.4']);
    assert({
      given:
        'a merged task still in progress, a merged task already in review (not stale), Done without a record merged and unmerged, Done with a record, an unmerged open task',
      should: 'flag the drift and target the correct pre-Done status',
      actual: staleLeaves(
        [
          task({ code: 'RT-1.1', status: 'in_progress' }),
          task({ code: 'RT-1.2', status: 'in_review' }),
          task({ code: 'RT-1.4', status: 'completed' }),
          task({ code: 'RT-1.5', status: 'completed' }),
          task({ code: 'RT-1.6', status: 'completed', hasReviewRecord: true }),
          task({ code: 'RT-1.7', status: 'ready' }),
        ],
        merged,
      ).map(({ task: { code }, reason, to }) => ({ code, reason, to })),
      expected: [
        { code: 'RT-1.1', reason: 'merged but in_progress', to: 'merged' },
        {
          code: 'RT-1.4',
          reason: 'Done without a review record',
          to: 'merged',
        },
        {
          code: 'RT-1.5',
          reason: 'Done without a review record',
          to: 'in_review',
        },
      ],
    });
  });
});

describe('reviewedCodes', () => {
  test('counts every code a review page names in its title or body', () => {
    assert({
      given: 'a stage review naming three codes and a single-leaf review',
      should: 'cover all four codes',
      actual: [
        ...reviewedCodes(
          [
            {
              id: 'r1',
              title: 'Review record — stage 1 (AUTH-1.1, AUTH-1.2)',
              content: '<p>Also covers AUTH-1.4.</p>',
            },
            { id: 'r2', title: 'Review — DOCS-4 cleanup', content: '' },
          ],
          (text) => text.match(/\b[A-Z]{2,6}-\d+(?:\.\d+)?\b/g) ?? [],
        ),
      ],
      expected: ['AUTH-1.1', 'AUTH-1.2', 'AUTH-1.4', 'DOCS-4'],
    });
  });
});
