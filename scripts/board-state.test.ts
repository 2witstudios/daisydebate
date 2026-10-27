import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  approvedByReview,
  deliveredCodes,
  findTaskPages,
  mergedTarget,
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
          {
            id: 'p4',
            type: 'TASK_LIST',
            title: 'RT-2.2f-r1 — Given c, should d',
          },
          {
            id: 'p5',
            type: 'TASK_LIST',
            title: 'AUTH-2.2.1 — Given e, should f',
          },
        ],
      },
    ],
  },
];

describe('findTaskPages', () => {
  test('maps task codes to task pages and their lists', () => {
    assert({
      given:
        'a drive tree with a leaf, its suffixed follow-up, a revision, a sub-leaf and a document',
      should:
        'return task-list pages keyed by the whole code their title starts with',
      actual: findTaskPages(tree),
      expected: [
        { code: 'RT-2.2', pageId: 'p1', listId: 'phase' },
        { code: 'RT-2.2f', pageId: 'p2', listId: 'phase' },
        { code: 'RT-2.2f-r1', pageId: 'p4', listId: 'phase' },
        { code: 'AUTH-2.2.1', pageId: 'p5', listId: 'phase' },
      ],
    });
  });
});

describe('mergedTarget', () => {
  const statuses = [
    'pending',
    'ready',
    'in_progress',
    'blocked',
    'in_review',
    'merged',
    'completed',
  ];
  test('moves open tasks to Merged and never regresses Done', () => {
    assert({
      given: 'each status a merged task can be in, without an approving review',
      should: 'target merged unless already merged or Done',
      actual: statuses.map((status) => mergedTarget(status, false)),
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
  test('moves every unfinished task to Done after an approving review', () => {
    assert({
      given: 'each status a merged task can be in, with an approving review',
      should: 'target completed unless already Done',
      actual: statuses.map((status) => mergedTarget(status, true)),
      expected: [...Array(6).fill('completed'), undefined],
    });
  });
});

describe('approvedByReview', () => {
  const head = 'a'.repeat(40);
  const review = (verdict: string, sha = head, reviewer = 'ag-rev') =>
    `## Review: x at ${sha}\n\nReviewer: ${reviewer} · Builder: ag-build\n\n### Verdict\n\n${verdict}\n`;
  const changes = '0 blocker / 1 major / 2 minor / 0 nit — CHANGES REQUESTED';
  const approve = '0 blocker / 0 major / 0 minor / 3 nit — APPROVE';
  const minors = '0 blocker / 0 major / 2 minor / 0 nit — APPROVE WITH MINORS';

  test('the latest verdict on the merged head decides', () => {
    assert({
      given: 'no verdict, approvals, and approvals before or after changes',
      should: 'approve only when the last verdict approves',
      actual: [
        [],
        ['LGTM', 'Fixed in abc.'],
        [review(approve)],
        [review(minors)],
        [review(changes), 'fixed', review(minors)],
        [review(minors), review(changes)],
      ].map((comments) => approvedByReview(comments, head)),
      expected: [false, false, true, true, true, false],
    });
  });

  test('an approval of another head, by the builder, or counting a blocker never approves', () => {
    assert({
      given:
        'an approval naming an earlier head, one whose reviewer is the builder, a bare verdict line, approvals counting a blocker or a major, a reply quoting an approval, and a verdict embedded mid-line',
      should: 'not approve',
      actual: [
        [review(approve, 'b'.repeat(40))],
        [review(approve, head, 'ag-build')],
        [approve],
        [review('1 blocker / 0 major / 0 minor / 0 nit — APPROVE')],
        [review('0 blocker / 2 major / 0 minor / 0 nit — APPROVE WITH MINORS')],
        [review(changes), `> ${review(approve).split('\n').join('\n> ')}`],
        [review(changes), `${review(changes)}\nlgtm ${approve}`],
      ].map((comments) => approvedByReview(comments, head)),
      expected: [false, false, false, false, false, false, false],
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
    ...overrides,
  });

  test('moves merged tasks that never reached In Review to Merged', () => {
    const merged = new Map([
      ['RT-1.1', '2026-09-20T00:00:00Z'],
      ['RT-1.2', '2026-09-20T00:00:00Z'],
      ['RT-1.3', '2026-09-20T00:00:00Z'],
    ]);
    assert({
      given:
        'merged tasks in progress, in review and Done, and an unmerged ready task',
      should: 'flag only the merged one before In Review',
      actual: staleLeaves(
        [
          task({ code: 'RT-1.1', status: 'in_progress' }),
          task({ code: 'RT-1.2', status: 'in_review' }),
          task({ code: 'RT-1.3', status: 'completed' }),
          task({ code: 'RT-1.7', status: 'ready' }),
        ],
        merged,
      ).map(({ task: { code }, reason, to }) => ({ code, reason, to })),
      expected: [
        { code: 'RT-1.1', reason: 'merged but in_progress', to: 'merged' },
      ],
    });
  });
});

describe('deliveredCodes', () => {
  test('reads delivered tasks from the title, branch and Tasks line only', () => {
    assert({
      given:
        'a PR whose body also mentions future leaves outside its Tasks line',
      should: 'return only the codes it declares it delivers',
      actual: deliveredCodes({
        title: 'feat(rt): presence leases (RT-3.1)',
        headRefName: 'pu/rt-3-1',
        body: [
          'Implements the lease model; RT-4.1 and RT-4.2 build on it later.',
          '- Tasks: [RT-3.1](url) · [RT-3.1b](url)',
          'See ADR 0033 and ISSUE-4.',
        ].join('\n'),
      }),
      expected: ['RT-3.1', 'RT-3.1b'],
    });
  });

  test('closes an issue only from the title or branch, never from a Tasks link', () => {
    const body = '- Tasks: [Issues list](url) · [ISSUE-1](url)';
    assert({
      given:
        'a PR whose Tasks line only links ISSUE-1, and one whose title names ISSUE-3',
      should: 'deliver no issue for the first and ISSUE-3 for the second',
      actual: [
        deliveredCodes({
          title: 'docs(agents): route findings to Issues',
          headRefName: 'docs/issues-list',
          body,
        }),
        deliveredCodes({
          title: 'fix(ci): pin the sprint-room actions (ISSUE-3)',
          headRefName: 'pu/issue-3',
          body: '- Tasks: [ISSUE-3](url)',
        }),
      ],
      expected: [[], ['ISSUE-3']],
    });
  });
});
