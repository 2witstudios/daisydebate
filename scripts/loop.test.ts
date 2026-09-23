import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ACTIVE,
  control,
  ESCALATED,
  escalate,
  findAgentWorktree,
  OWNER_CHANNEL,
  type LoopDeps,
} from './loop';
import { recordPath, serializeRecord } from './agent-registry';

setupRitewayBun();

const project = '/w';
const child = '/w/.pu/worktrees/wt-child';
// The registry entry the parent's agent:spawn wrote, outside the worktree.
const registered = (parent: string | null) => ({
  [recordPath(project, 'ag-child')]: serializeRecord({
    parent,
    role: 'builder',
    worktree: child,
  }),
});
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
      agents: {
        'ag-child': { id: 'ag-child' },
        'ag-term': { id: 'ag-term', agentType: 'terminal' },
      },
    },
  ],
});

function fakes(
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

const escalatedFixture = () => {
  const run = fakes({
    [`${child}/${ACTIVE}`]: state,
    ...registered('ag-parent'),
  });
  escalate(run.deps, 'stalled', 'Two identical scans');
  return Object.fromEntries(run.fs);
};

describe('loop:escalate', () => {
  test('pauses the loop, keeps its state and notifies the recorded parent', () => {
    const { deps, calls, fs } = fakes({
      [`${child}/${ACTIVE}`]: state,
      ...registered('ag-parent'),
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

  test('notifies the parent before it moves the loop state', () => {
    const { deps, calls } = fakes({
      [`${child}/${ACTIVE}`]: state,
      ...registered('ag-parent'),
    });
    escalate(deps, 'stalled', 'Two identical scans');
    const at = (word: string) => calls.findIndex((call) => call[0] === word);
    assert({
      given: 'an escalation with a registered parent',
      should: 'send to the parent before writing the escalated state',
      actual: at('pu') < at('write') && at('pu') !== -1,
      expected: true,
    });
  });

  test('notifies the owner on the Epic Updates channel when no parent is registered', () => {
    const { deps, calls } = fakes({ [`${child}/${ACTIVE}`]: state });
    const code = escalate(
      deps,
      'needs-owner',
      'Only the owner can grant the secret',
    );
    const channel = calls.find(
      (call) => call.slice(0, 3).join(' ') === 'pagespace channels send',
    );
    assert({
      given: 'an active loop with no registered parent',
      should:
        'post to the owner channel, comment on the PR and send to no agent',
      actual: {
        code,
        channel: channel?.[3],
        mentionsCommands: channel?.[4]?.includes('bun loop:close ag-child'),
        puSends: calls.some((call) => call[0] === 'pu'),
        prComment: calls.some(
          (call) => call.slice(0, 3).join(' ') === 'gh pr comment',
        ),
      },
      expected: {
        code: 0,
        channel: OWNER_CHANNEL,
        mentionsCommands: true,
        puSends: false,
        prComment: true,
      },
    });
  });

  test('pauses the loop when only the PR comment reached anyone', () => {
    const { deps, fs } = fakes(
      { [`${child}/${ACTIVE}`]: state, ...registered('ag-parent') },
      {},
      ['pu send ag-parent'],
    );
    assert({
      given: 'a parent pu send that fails and a PR comment that posts',
      should: 'still pause the loop, because the PR records the escalation',
      actual: [
        escalate(deps, 'blocked', 'CI secret missing'),
        fs.has(`${child}/${ESCALATED}`),
      ],
      expected: [0, true],
    });
  });

  test('leaves the loop active and fails when nobody was told', () => {
    const cases = [
      fakes({ [`${child}/${ACTIVE}`]: state, ...registered('ag-parent') }, {}, [
        'pu send ag-parent',
        'gh pr comment',
      ]),
      fakes({ [`${child}/${ACTIVE}`]: state }, {}, [
        'pagespace channels send',
        'gh pr view',
      ]),
    ];
    assert({
      given:
        'a failed parent send and PR comment, and a failed owner post with no PR',
      should: 'exit non-zero and leave the loop state as it was',
      actual: cases.map(({ deps, fs }) => [
        escalate(deps, 'blocked', 'CI secret missing'),
        fs.get(`${child}/${ACTIVE}`) === state,
        fs.has(`${child}/${ESCALATED}`),
      ]),
      expected: [
        [1, true, false],
        [1, true, false],
      ],
    });
  });

  test('fails without pausing when the commit cannot be read', () => {
    const { deps, calls, fs } = fakes(
      { [`${child}/${ACTIVE}`]: state, ...registered('ag-parent') },
      {},
      ['git rev-parse'],
    );
    assert({
      given: 'git rev-parse HEAD failing',
      should: 'exit 1, notify nobody and leave the loop active',
      actual: [
        escalate(deps, 'blocked', 'CI secret missing'),
        calls.some((call) => call[0] === 'pu' || call[0] === 'gh'),
        fs.get(`${child}/${ACTIVE}`) === state,
      ],
      expected: [1, false, true],
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
    const run = fakes(escalatedFixture(), { agentId: undefined });
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
        run.calls.find((call) => call[1] === 'send')?.[3],
      ],
      expected: [
        0,
        false,
        false,
        '**Loop closed** by the owner: Merged by the owner',
        '[loop] Your loop was closed by the owner: Merged by the owner. It will not resume. Finish your handoff: commit, push, update the handoff page and report to your parent.',
      ],
    });
  });

  test('credits the parent agent that ran the command, not the owner', () => {
    const run = fakes(escalatedFixture(), { agentId: 'ag-parent' });
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

  test('refuses a child closing its own loop through a sibling id', () => {
    const run = fakes(escalatedFixture(), { agentId: 'ag-child' });
    assert({
      given: 'the child naming the terminal agent in its own worktree',
      should: 'refuse, because the escalated loop is ag-child\u2019s',
      actual: [
        control(run.deps, 'close', 'ag-term', 'done'),
        run.fs.has(`${child}/${ESCALATED}`),
      ],
      expected: [1, true],
    });
  });

  test('refuses a pu agent that is not autonomous but is not the parent either', () => {
    const run = fakes(escalatedFixture(), { agentId: 'ag-resumed' });
    assert({
      given: 'a caller with a PU_AGENT_ID other than the registered parent',
      should: 'refuse: only no agent id at all means the owner',
      actual: control(run.deps, 'resume', 'ag-child', 'go on'),
      expected: 1,
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
