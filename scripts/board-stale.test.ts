import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ISSUES_LIST_ID } from './board-model';
import { runStaleCheck, type StaleDeps } from './board-stale';

setupRitewayBun();

const lists: Record<string, object> = {
  phase1: {
    tasks: [
      {
        id: 't1',
        pageId: 'p1',
        title: 'RT-1.1 — Given a, should b',
        status: 'in_progress',
      },
      {
        id: 't2',
        pageId: 'p2',
        title: 'RT-1.2 — Given c, should d',
        status: 'completed',
        completedAt: '2026-09-25T00:00:00Z',
      },
      {
        id: 't3',
        pageId: 'p3',
        title: 'RT-1.3 — Given e, should f',
        status: 'completed',
      },
    ],
    availableStatuses: [{ slug: 'in_progress' }, { slug: 'completed' }],
  },
};

function fakes(gh?: StaleDeps['gh']) {
  const calls: string[][] = [];
  const output: string[] = [];
  const deps: StaleDeps = {
    pagespace: (args) => {
      calls.push([...args]);
      if (args[0] === 'pages' && args[1] === 'tree')
        return {
          code: 0,
          stdout: JSON.stringify({
            pages: [
              {
                id: 'phase1',
                type: 'TASK_LIST',
                title: 'Phase',
                hasChildren: true,
              },
              {
                id: 'p1',
                type: 'TASK_LIST',
                title: 'RT-1.1 — x',
                hasChildren: false,
              },
            ],
          }),
        };
      if (args[0] === 'tasks' && args[1] === 'list')
        return {
          code: 0,
          stdout: JSON.stringify(
            lists[args[2]] ?? { tasks: [], availableStatuses: [] },
          ),
        };
      return { code: 0, stdout: '{}' };
    },
    gh:
      gh ??
      (() => ({
        code: 0,
        stdout: JSON.stringify([
          {
            number: 40,
            title: 'feat: RT-1.1',
            headRefName: 'pu/rt-1-1',
            body: '',
            mergedAt: '2026-09-20T00:00:00Z',
          },
        ]),
      })),
    out: (text) => void output.push(text),
  };
  return { deps, calls, output };
}

describe('bun board:stale', () => {
  test('lists drift without changing anything by default', () => {
    const { deps, calls, output } = fakes();
    const code = runStaleCheck(deps, false);
    assert({
      given: 'a merged task in progress and two Done tasks',
      should: 'report only the merged task with its fix and update nothing',
      actual: [
        code,
        output.join('').includes('RT-1.1 merged but in_progress → merged'),
        output.join('').includes('RT-1.2') ||
          output.join('').includes('RT-1.3'),
        calls.some((call) => call[1] === 'update'),
      ],
      expected: [0, true, false, false],
    });
  });

  test('applies pre-Done statuses once, creating Merged and never marking Done', () => {
    const { deps, calls } = fakes();
    runStaleCheck(deps, true);
    const writes = calls.filter(
      (call) => call[1] === 'update' || call[1] === 'create-status',
    );
    assert({
      given: '--apply',
      should:
        'create the Merged status and move each drifted task back before Done',
      actual: writes.map((call) => call.slice(0, 5).join(' ')),
      expected: [
        'tasks create-status phase1 --name Merged',
        'tasks update phase1 t1 --status',
      ],
    });
    assert({
      given: '--apply',
      should: 'never set completed',
      actual: writes.some((call) => call.includes('completed')),
      expected: false,
    });
  });

  test('fails on an issue filed directly under Issues', () => {
    const { deps, output } = fakes();
    const pagespace: StaleDeps['pagespace'] = (args) => {
      if (args[0] === 'pages' && args[1] === 'tree')
        return {
          code: 0,
          stdout: JSON.stringify({
            pages: [
              {
                id: ISSUES_LIST_ID,
                type: 'TASK_LIST',
                title: 'Issues',
                hasChildren: true,
              },
            ],
          }),
        };
      if (args[0] === 'tasks' && args[1] === 'list')
        return {
          code: 0,
          stdout: JSON.stringify({
            tasks: [
              { id: 'b', pageId: 'bugs', title: 'Bugs', status: 'pending' },
              {
                id: 'i',
                pageId: 'i7',
                title: 'ISSUE-7 — Given a, should b',
                status: 'pending',
              },
            ],
            availableStatuses: [],
          }),
        };
      return deps.pagespace(args);
    };
    assert({
      given: 'ISSUE-7 a direct child of Issues beside the Bugs bucket',
      should: 'exit 1 and name the issue to file into a bucket',
      actual: [
        runStaleCheck({ ...deps, pagespace }, false),
        output
          .join('')
          .includes(
            'ERROR ISSUE-7 sits directly under Issues; file it into a bucket  (i7)',
          ),
      ],
      expected: [1, true],
    });
  });

  test('fails with a message when gh cannot list the merged PRs', () => {
    const { deps, calls, output } = fakes(() => ({ code: 1, stdout: '' }));
    assert({
      given: 'gh exiting non-zero, as outside a repository',
      should: 'exit 1 naming gh, before reading the board',
      actual: [runStaleCheck(deps, false), output.join(''), calls.length],
      expected: [1, 'gh pr list failed (exit 1); nothing was checked.\n', 0],
    });
  });
});
