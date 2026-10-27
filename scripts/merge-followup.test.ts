import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  followUpMerge,
  readTaskList,
  type FollowupDeps,
  type MergedPr,
} from './merge-followup';

setupRitewayBun();

const tree = [
  {
    id: 'phase',
    type: 'TASK_LIST',
    title: 'Phase — Guardrails',
    children: [
      { id: 'leaf1', type: 'TASK_LIST', title: 'GRD-6.1 — Given a, should b' },
      { id: 'leaf2', type: 'TASK_LIST', title: 'GRD-6.2 — Given c, should d' },
    ],
  },
];

const pr: MergedPr = {
  number: 61,
  title: 'feat(guard): autonomy guardrails (GRD-6.1)',
  body: 'Tasks: GRD-6.1',
  branch: 'pu/grd-6-autonomy',
};

const approve = '0 blocker / 0 major / 1 minor / 0 nit — APPROVE WITH MINORS';

function fakes(
  options: { statuses?: string[]; comments?: string[]; leaf1?: string } = {},
) {
  const log: string[] = [];
  const tasks: Record<string, { id: string; pageId: string; status: string }> =
    {
      leaf1: {
        id: 't1',
        pageId: 'leaf1',
        status: options.leaf1 ?? 'in_review',
      },
      leaf2: { id: 't2', pageId: 'leaf2', status: 'pending' },
    };
  const deps: FollowupDeps = {
    drivePages: async () => tree,
    listTasks: async () => ({
      tasks: Object.values(tasks),
      availableStatuses: (options.statuses ?? ['in_review', 'completed']).map(
        (slug) => ({ slug }),
      ),
    }),
    createStatus: async (listId) => void log.push(`create-status ${listId}`),
    updateStatus: async (listId, taskId, status) =>
      void log.push(`status ${listId} ${taskId} ${status}`),
    comments: async () => options.comments ?? [],
  };
  return { deps, log };
}

describe('merge follow-up', () => {
  test('moves a merge without an approving review to Merged, creating the status once', async () => {
    const { deps, log } = fakes();
    const result = await followUpMerge(deps, {
      ...pr,
      body: 'Tasks: GRD-6.1 · GRD-6.2',
    });
    assert({
      given: 'a merge naming two tasks of a list without a Merged status',
      should: 'create the status once and move both tasks to Merged',
      actual: [log, result],
      expected: [
        [
          'create-status phase',
          'status phase t1 merged',
          'status phase t2 merged',
        ],
        { moved: ['GRD-6.1', 'GRD-6.2'], status: 'merged' },
      ],
    });
  });

  test('moves a merge whose latest review verdict approves straight to Done', async () => {
    const { deps, log } = fakes({
      comments: [
        '## Review\n\n1 blocker / 0 major / 0 minor / 0 nit — CHANGES REQUESTED',
        'Fixed in abc123.',
        `## Verdict\n\n${approve}\n\nRecord: https://pagespace.ai/x`,
      ],
    });
    const result = await followUpMerge(deps, pr);
    assert({
      given: 'changes requested, then a later approving verdict',
      should: 'move GRD-6.1 to Done without creating a Merged status',
      actual: [log, result.status],
      expected: [['status phase t1 completed'], 'completed'],
    });
  });

  test('a later CHANGES REQUESTED overrides an earlier approval', async () => {
    const { deps, log } = fakes({
      statuses: ['merged'],
      comments: [
        `${approve}`,
        '0 blocker / 1 major / 0 minor / 0 nit — CHANGES REQUESTED',
      ],
    });
    await followUpMerge(deps, pr);
    assert({
      given: 'an approval superseded by a later CHANGES REQUESTED',
      should: 'leave the task in Merged for the board keeper',
      actual: log,
      expected: ['status phase t1 merged'],
    });
  });

  test('never moves a Done task or repeats its current status', async () => {
    const done = fakes({ leaf1: 'completed', comments: [approve] });
    const merged = fakes({ leaf1: 'merged', statuses: ['merged'] });
    await followUpMerge(done.deps, pr);
    await followUpMerge(merged.deps, pr);
    assert({
      given: 'a task already Done, and one already Merged with no approval',
      should: 'write nothing',
      actual: [done.log, merged.log],
      expected: [[], []],
    });
  });
});

describe('reading the live PageSpace tasks API', () => {
  test('takes statuses from statusConfigs and tasks from every page', async () => {
    // The shape GET /api/pages/:id/tasks returns: statusConfigs, not
    // availableStatuses, and at most `limit` tasks with hasMore.
    const pages = [
      {
        tasks: [{ id: 't1', pageId: 'p1', status: 'in_review', title: 'A' }],
        statusConfigs: [
          { slug: 'in_review', name: 'In Review', group: 'in_progress' },
          { slug: 'completed', name: 'Done', group: 'done' },
        ],
        hasMore: true,
      },
      {
        tasks: [{ id: 't2', pageId: 'p2', status: 'pending', title: 'B' }],
        statusConfigs: [],
        hasMore: false,
      },
    ];
    const offsets: number[] = [];
    const list = await readTaskList(async (offset) => {
      offsets.push(offset);
      return pages[offsets.length - 1];
    });
    assert({
      given: 'two pages of one task each and the list statuses on the first',
      should:
        'return both tasks and the list statuses, fetching offsets 0 and 1',
      actual: [
        list.tasks.map((task) => task.id),
        list.availableStatuses.map((status) => status.slug),
        offsets,
      ],
      expected: [
        ['t1', 't2'],
        ['in_review', 'completed'],
        [0, 1],
      ],
    });
  });

  test('advances by the rows received when the server caps below the request', async () => {
    // The follow-up asks for 200 per page; a deployed server caps at 2.
    const rows = ['t1', 't2', 't3', 't4', 't5'];
    const offsets: number[] = [];
    const list = await readTaskList(async (offset) => {
      offsets.push(offset);
      const slice = rows.slice(offset, offset + 2);
      return {
        tasks: slice.map((id) => ({ id, pageId: id, status: 'pending' })),
        statusConfigs: [],
        hasMore: offset + 2 < rows.length,
      };
    });
    assert({
      given: 'five tasks served two at a time although 200 were requested',
      should: 'fetch offsets 0, 2 and 4 and skip no task',
      actual: [offsets, list.tasks.map((task) => task.id)],
      expected: [[0, 2, 4], rows],
    });
  });
});
