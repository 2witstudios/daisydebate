import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { recordPath, serializeRecord } from './agent-registry';
import {
  control,
  ESCALATED,
  escalate,
  OWNER_CHANNEL,
  registryRoot,
  ACTIVE,
} from './loop';
import {
  child,
  escalatedFixture,
  fakes,
  project,
  state,
} from './loop.test-support';

setupRitewayBun();

describe('loop control without an agent id', () => {
  test('counts as the owner only after a confirmation typed at a terminal', () => {
    const asked: string[] = [];
    const confirmed = fakes(escalatedFixture(), {
      agentId: undefined,
      confirmOwner: (question) => {
        asked.push(question);
        return true;
      },
    });
    const noTty = fakes(escalatedFixture(), {
      agentId: undefined,
      confirmOwner: () => false,
    });
    assert({
      given:
        'no PU_AGENT_ID with a yes typed at /dev/tty, and no PU_AGENT_ID with no terminal (env -i in an agent shell)',
      should:
        'close for the first after asking, and refuse the second with the state kept',
      actual: [
        control(confirmed.deps, 'close', 'ag-child', 'done'),
        asked.length,
        control(noTty.deps, 'close', 'ag-child', 'done'),
        noTty.fs.has(`${child}/${ESCALATED}`),
      ],
      expected: [0, 1, 1, true],
    });
  });

  test('never asks a caller that has an agent id', () => {
    let asked = false;
    const run = fakes(escalatedFixture(), {
      agentId: 'ag-parent',
      confirmOwner: () => {
        asked = true;
        return true;
      },
    });
    assert({
      given: 'the registered parent',
      should: 'close without a terminal prompt',
      actual: [control(run.deps, 'close', 'ag-child', 'done'), asked],
      expected: [0, false],
    });
  });
});

describe('loop control: the sibling check', () => {
  test('refuses a child that names a sibling it registered as its own child', () => {
    // The child spawned ag-term into its own worktree, so ag-term's
    // registered parent is the child itself.
    const run = fakes(
      {
        ...escalatedFixture(),
        [recordPath(project, 'ag-term')]: serializeRecord({
          parent: 'ag-child',
          role: 'reviewer',
          worktree: child,
        }),
      },
      { agentId: 'ag-child' },
    );
    assert({
      given: "the child closing 'ag-term', whose registered parent it is",
      should: 'refuse: the escalated loop belongs to ag-child, not ag-term',
      actual: [
        control(run.deps, 'close', 'ag-term', 'done'),
        run.fs.has(`${child}/${ESCALATED}`),
      ],
      expected: [1, true],
    });
  });
});

describe('loop registry root', () => {
  test('comes from the git common dir, whatever PU_PROJECT_ROOT says', () => {
    const run = (args: readonly string[]) =>
      args.join(' ') === 'git rev-parse --path-format=absolute --git-common-dir'
        ? { code: 0, stdout: '/repo/.git\n' }
        : { code: 1, stdout: '' };
    assert({
      given: 'a worktree whose git common dir is /repo/.git',
      should: 'use /repo, and nothing when git fails',
      actual: [
        registryRoot(run, '/repo/.pu/worktrees/wt-1'),
        registryRoot(() => ({ code: 128, stdout: '' }), '/tmp'),
      ],
      expected: ['/repo', undefined],
    });
  });
});

describe('loop:escalate when only the PR comment got through', () => {
  test('also tells the owner that the parent was not reached', () => {
    const { deps, calls } = fakes(
      {
        [`${child}/${ACTIVE}`]: state,
        [recordPath(project, 'ag-child')]: serializeRecord({
          parent: 'ag-parent',
          role: 'builder',
          worktree: child,
        }),
      },
      {},
      ['pu send ag-parent'],
    );
    const code = escalate(deps, 'blocked', 'CI secret missing');
    assert({
      given: 'a parent send that fails and a PR comment that posts',
      should: 'pause the loop and post to the owner channel too',
      actual: [
        code,
        calls.some(
          (call) =>
            call.slice(0, 4).join(' ') ===
            `pagespace channels send ${OWNER_CHANNEL}`,
        ),
      ],
      expected: [0, true],
    });
  });
});
