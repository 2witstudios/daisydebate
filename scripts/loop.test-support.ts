// Shared fakes for the loop tests: files, pu, gh and git in memory.
import { recordPath, serializeRecord } from './agent-registry';
import { ACTIVE, escalate, type LoopDeps } from './loop';

export const project = '/w';
export const child = '/w/.pu/worktrees/wt-child';
// The registry entry the parent's agent:spawn wrote, outside the worktree.
export const registered = (parent: string | null) => ({
  [recordPath(project, 'ag-child')]: serializeRecord({
    parent,
    role: 'builder',
    worktree: child,
  }),
});
export const state = [
  '---',
  'active: true',
  'iteration: 12',
  'session_id: s-9',
  'max_iterations: 40',
  'completion_promise: "CONVERGED"',
  '---',
  '',
  'Converge the PR.',
  '',
].join('\n');

export const status = JSON.stringify({
  worktrees: [
    {
      path: child,
      branch: 'pu/child',
      agents: {
        'ag-child': { id: 'ag-child' },
        'ag-term': { id: 'ag-term', agentType: 'terminal' },
      },
    },
  ],
});

export function fakes(
  files: Record<string, string>,
  overrides: Partial<LoopDeps> = {},
  // Command lines (by prefix) that fail.
  failing: readonly string[] = [],
) {
  const calls: string[][] = [];
  const notices: string[] = [];
  const fs = new Map(Object.entries(files));
  const deps: LoopDeps = {
    cwd: child,
    projectRoot: project,
    agentId: 'ag-child',
    confirmOwner: () => true,
    now: () => '2026-09-22T12:00:00.000Z',
    read: (path) => fs.get(path),
    write: (path, text) => {
      calls.push(['write', path]);
      fs.set(path, text);
    },
    remove: (path) => void fs.delete(path),
    run: (args) => {
      calls.push([...args]);
      if (failing.some((prefix) => args.join(' ').startsWith(prefix)))
        return { code: 1, stdout: '' };
      const command = args.slice(0, 3).join(' ');
      if (command === 'git rev-parse HEAD')
        return { code: 0, stdout: `${'b'.repeat(40)}\n` };
      if (command === 'gh pr view' || command === 'gh pr list')
        return { code: 0, stdout: '57\n' };
      if (command === 'pu status --json') return { code: 0, stdout: status };
      return { code: 0, stdout: '' };
    },
    notice: (text) => void notices.push(text),
    ...overrides,
  };
  return { deps, calls, notices, fs };
}

export const escalatedFixture = () => {
  const run = fakes({
    [`${child}/${ACTIVE}`]: state,
    ...registered('ag-parent'),
  });
  escalate(run.deps, 'stalled', 'Two identical scans');
  return Object.fromEntries(run.fs);
};
