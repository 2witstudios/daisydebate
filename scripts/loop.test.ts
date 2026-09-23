import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ACTIVE,
  control,
  ESCALATED,
  escalate,
  findAgentWorktree,
  PARENT,
  type LoopDeps,
} from './loop';

setupRitewayBun();

const child = '/w/.pu/worktrees/wt-child';
const state = [
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

const status = JSON.stringify({
  worktrees: [
    {
      path: child,
      branch: 'pu/child',
      agents: { 'ag-child': { id: 'ag-child' } },
    },
  ],
});

function fakes(
  files: Record<string, string>,
  overrides: Partial<LoopDeps> = {},
) {
  const calls: string[][] = [];
  const notices: string[] = [];
  const fs = new Map(Object.entries(files));
  const deps: LoopDeps = {
    cwd: child,
    autonomous: true,
    agentId: 'ag-child',
    now: () => '2026-09-22T12:00:00.000Z',
    read: (path) => fs.get(path),
    write: (path, text) => void fs.set(path, text),
    remove: (path) => void fs.delete(path),
    run: (args) => {
      calls.push([...args]);
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

const escalatedFixture = () => {
  const run = fakes({
    [`${child}/${ACTIVE}`]: state,
    [`${child}/${PARENT}`]: 'ag-parent\n',
  });
  escalate(run.deps, 'stalled', 'Two identical scans');
  return Object.fromEntries(run.fs);
};

describe('loop:escalate', () => {
  test('pauses the loop, keeps its state and notifies the recorded parent', () => {
    const { deps, calls, fs } = fakes({
      [`${child}/${ACTIVE}`]: state,
      [`${child}/${PARENT}`]: 'ag-parent\n',
    });
    const code = escalate(deps, 'stalled', 'Two identical scans');
    const escalated = fs.get(`${child}/${ESCALATED}`) ?? '';
    const sends = calls.filter((call) => call[0] === 'pu');
    assert({
      given: 'an active loop with a recorded parent',
      should:
        'move the state aside with iteration kept, send twice to the parent and comment on the PR',
      actual: {
        code,
        activeGone: !fs.has(`${child}/${ACTIVE}`),
        keepsIteration: escalated.includes('iteration: 12'),
        keepsPrompt: escalated.endsWith('Converge the PR.\n'),
        sendTargets: sends.map((call) => call[2]),
        submitNudge: sends[1]?.[3],
        commandsInMessage: sends[0]?.[3].includes(
          'bun loop:close ag-child "<why>"',
        ),
        prComment: calls.some(
          (call) => call.slice(0, 4).join(' ') === 'gh pr comment 57',
        ),
      },
      expected: {
        code: 0,
        activeGone: true,
        keepsIteration: true,
        keepsPrompt: true,
        sendTargets: ['ag-parent', 'ag-parent'],
        submitNudge: '',
        commandsInMessage: true,
        prComment: true,
      },
    });
  });

  test('notifies the owner when no parent is recorded', () => {
    const { deps, calls, notices } = fakes({ [`${child}/${ACTIVE}`]: state });
    escalate(deps, 'needs-owner', 'Only the owner can grant the secret');
    assert({
      given: 'an active loop without .daisy/parent',
      should: 'print an owner notice, comment on the PR and send nothing',
      actual: [
        notices.some((notice) => notice.startsWith('OWNER NOTICE')),
        calls.some((call) => call[0] === 'pu'),
        calls.some((call) => call.slice(0, 3).join(' ') === 'gh pr comment'),
      ],
      expected: [true, false, true],
    });
  });

  test('refuses unknown reasons and a missing loop', () => {
    assert({
      given: 'an unknown reason, an empty detail, and no active loop',
      should: 'exit non-zero without changing state',
      actual: [
        escalate(fakes({ [`${child}/${ACTIVE}`]: state }).deps, 'done', 'x'),
        escalate(fakes({ [`${child}/${ACTIVE}`]: state }).deps, 'blocked', ' '),
        escalate(fakes({}).deps, 'blocked', 'x'),
      ],
      expected: [2, 2, 1],
    });
  });
});

describe('loop:close and loop:resume', () => {
  test('lets the parent resume the loop exactly as it was', () => {
    const run = fakes(escalatedFixture(), {
      cwd: '/w/.pu/worktrees/wt-parent',
      agentId: 'ag-parent',
    });
    const code = control(run.deps, 'resume', 'ag-child', 'Fix the two threads');
    assert({
      given: 'an escalated loop and its parent',
      should: 'restore the active state, message the child and comment',
      actual: {
        code,
        restored: run.fs.get(`${child}/${ACTIVE}`),
        escalatedGone: !run.fs.has(`${child}/${ESCALATED}`),
        toChild: run.calls.find(
          (call) => call[0] === 'pu' && call[1] === 'send',
        )?.[2],
        comment: run.calls.some(
          (call) => call.slice(0, 4).join(' ') === 'gh pr comment 57',
        ),
      },
      expected: {
        code: 0,
        restored: state,
        escalatedGone: true,
        toChild: 'ag-child',
        comment: true,
      },
    });
  });

  test('lets the owner close the loop and records it on the PR', () => {
    const run = fakes(escalatedFixture(), {
      autonomous: false,
      agentId: undefined,
    });
    const code = control(run.deps, 'close', 'ag-child', 'Merged by the owner.');
    const comment = run.calls.find(
      (call) => call.slice(0, 3).join(' ') === 'gh pr comment',
    );
    assert({
      given: 'an escalated loop and an owner session',
      should: 'remove the state without restoring it and comment the outcome',
      actual: [
        code,
        run.fs.has(`${child}/${ACTIVE}`),
        run.fs.has(`${child}/${ESCALATED}`),
        comment?.[5],
        run.calls.find((call) => call[1] === 'send')?.[3]?.includes('owner..'),
      ],
      expected: [
        0,
        false,
        false,
        '**Loop closed** by the owner: Merged by the owner',
        false,
      ],
    });
  });

  test('credits the parent agent that ran the command, not the owner', () => {
    const run = fakes(escalatedFixture(), {
      autonomous: false,
      agentId: 'ag-parent',
    });
    control(run.deps, 'close', 'ag-child', 'Proof accepted');
    const comment = run.calls.find(
      (call) => call.slice(0, 3).join(' ') === 'gh pr comment',
    );
    assert({
      given: 'a parent agent session without DAISY_AUTONOMOUS closing the loop',
      should: 'name the parent agent as the closer',
      actual: comment?.[5],
      expected: '**Loop closed** by ag-parent: Proof accepted',
    });
  });

  test('refuses the loop agent closing or resuming its own loop', () => {
    const files = escalatedFixture();
    const close = fakes(files);
    const resume = fakes(files);
    assert({
      given: 'the child agent running close and resume on itself',
      should: 'refuse both and leave the escalated state untouched',
      actual: [
        control(close.deps, 'close', 'ag-child', 'done'),
        close.fs.has(`${child}/${ESCALATED}`),
        control(resume.deps, 'resume', 'ag-child', 'go'),
        resume.fs.has(`${child}/${ACTIVE}`),
      ],
      expected: [1, true, 1, false],
    });
  });

  test('refuses an agent that is not the recorded parent', () => {
    const run = fakes(escalatedFixture(), { agentId: 'ag-stranger' });
    assert({
      given: 'an unrelated autonomous agent',
      should: 'refuse',
      actual: control(run.deps, 'close', 'ag-child', 'mine now'),
      expected: 1,
    });
  });
});

describe('findAgentWorktree', () => {
  test('resolves an agent id to its worktree from pu status', () => {
    assert({
      given: 'pu status --json output',
      should: 'return the worktree path and branch, or undefined',
      actual: [
        findAgentWorktree(status, 'ag-child'),
        findAgentWorktree(status, 'ag-none'),
      ],
      expected: [{ path: child, branch: 'pu/child' }, undefined],
    });
  });
});
