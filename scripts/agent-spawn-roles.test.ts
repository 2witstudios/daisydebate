import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { recordPath, serializeRecord } from './agent-registry';
import { spawnAgent } from './agent-spawn';
import { parseSpawnArgs } from './agent-spawn-model';
import {
  repo,
  fakeMachine,
  spawned,
  reviewArgs,
  working,
} from './agent-spawn.test-support';

setupRitewayBun();

describe('parseSpawnArgs for an autonomous agent', () => {
  const task = ['--task', 'tmzz7plnnrlz21d6qyyjp8sq'];
  const spawn = ['--', '-n', 'x', 'prompt'];
  const errorOf = (argv: string[], autonomous: boolean) => {
    const parsed = parseSpawnArgs(argv, autonomous);
    return 'error' in parsed ? parsed.error.split('\n')[0] : 'ok';
  };

  const review = ['--role', 'reviewer', '--worktree', 'wt-8zirdrl0'];

  test('refuses unknown roles, a builder without a leaf and a reviewer without a worktree', () => {
    assert({
      given:
        'an unknown role, a builder without --task, a reviewer without --worktree and a builder with one',
      should: 'refuse each with its reason',
      actual: [
        errorOf([...task, '--role', 'boss', ...spawn], true),
        errorOf(spawn, true),
        errorOf(['--role', 'reviewer', ...spawn], true),
        errorOf([...task, '--worktree', 'wt-8zirdrl0', ...spawn], true),
      ],
      expected: [
        '--role must be builder or reviewer',
        'An autonomous agent spawns a builder only for a leaf: pass --task <leafPageId>.',
        'A reviewer joins the worktree it reviews: pass --worktree <existing worktree id>.',
        '--worktree is only for reviewers: a builder gets a new worktree.',
      ],
    });
  });

  test('accepts a reviewer for an existing worktree and a leaf builder from an agent', () => {
    const planOf = (argv: string[], autonomous: boolean) => {
      const parsed = parseSpawnArgs(argv, autonomous);
      return 'error' in parsed
        ? parsed.error
        : [parsed.role, parsed.task, parsed.worktree];
    };
    assert({
      given:
        'an agent spawning a reviewer, and an agent spawning a leaf builder',
      should: 'plan each role with its worktree or leaf',
      actual: [
        planOf([...review, '--', 'Review PR #61'], true),
        planOf([...task, ...spawn], true),
      ],
      expected: [
        ['reviewer', undefined, 'wt-8zirdrl0'],
        ['builder', 'tmzz7plnnrlz21d6qyyjp8sq', undefined],
      ],
    });
  });
});

describe('bun agent:spawn for a reviewer', () => {
  test('joins the existing worktree', async () => {
    const machine = fakeMachine({ builders: 3, reviewers: 1 });
    const code = await spawnAgent(working(machine), reviewArgs('wt-b0'));
    assert({
      given:
        'an agent spawning a reviewer for wt-b0 with three builders and one reviewer running',
      should:
        'spawn into wt-b0 without a new worktree or setup, and register the reviewer',
      actual: {
        code,
        spawns: spawned(machine.calls).map((call) => call.slice(0, 6)),
        setup: machine.calls.some((call) => call[0] === 'bun'),
        record: machine.files.get(recordPath(repo, 'ag-new')),
      },
      expected: {
        code: 0,
        spawns: [['pu', 'spawn', '-w', 'wt-b0', '-a', 'claude']],
        setup: false,
        record: serializeRecord({
          parent: 'ag-parent',
          role: 'reviewer',
          worktree: '/repo/.pu/worktrees/wt-b0',
        }),
      },
    });
  });

  test('refuses a reviewer for a worktree pu does not list, but never on reviewer count', async () => {
    const missing = fakeMachine({ builders: 1 });
    const many = fakeMachine({ builders: 1, reviewers: 9 });
    const results = [
      await spawnAgent(working(missing), reviewArgs('wt-nope')),
      await spawnAgent(working(many), reviewArgs('wt-b0')),
    ];
    assert({
      given:
        'a worktree that does not exist, and nine reviewers already running',
      should:
        'refuse only the missing worktree; any number of reviewers spawns',
      actual: [
        results,
        spawned(missing.calls).length,
        spawned(many.calls).length,
        missing.output.join('').includes('no worktree wt-nope'),
      ],
      expected: [[1, 0], 0, 1, true],
    });
  });
});
