import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { recordPath, serializeRecord } from './agent-registry';
import { spawnAgent } from './agent-spawn';
import { activeCount, parseSpawnArgs } from './agent-spawn-model';
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

  test('refuses the cap, unknown roles, a builder without a leaf and a reviewer without a worktree', () => {
    assert({
      given:
        'an autonomous --cap, an unknown role, a builder without --task, a reviewer without --worktree and a builder with one',
      should: 'refuse each with its reason',
      actual: [
        errorOf([...task, '--cap', '99', ...spawn], true),
        errorOf([...review, '--cap', '9', ...spawn], true),
        errorOf([...task, '--role', 'boss', ...spawn], true),
        errorOf(spawn, true),
        errorOf(['--role', 'reviewer', ...spawn], true),
        errorOf([...task, '--worktree', 'wt-8zirdrl0', ...spawn], true),
      ],
      expected: [
        'Only the owner can pass --cap.',
        'Only the owner can pass --cap.',
        '--role must be builder or reviewer',
        'An autonomous agent spawns a builder only for a leaf: pass --task <leafPageId>.',
        'A reviewer joins the worktree it reviews: pass --worktree <existing worktree id>.',
        '--worktree is only for reviewers: a builder gets a new worktree.',
      ],
    });
  });

  test('accepts a reviewer for an existing worktree from an agent, and the caps from the owner', () => {
    const planOf = (argv: string[], autonomous: boolean) => {
      const parsed = parseSpawnArgs(argv, autonomous);
      return 'error' in parsed
        ? parsed.error
        : [parsed.role, parsed.cap, parsed.worktree];
    };
    assert({
      given:
        'an agent spawning a reviewer, an agent spawning a leaf builder, and the owner setting each cap',
      should:
        'use the per-role defaults (builder 3, reviewer uncapped) unless the owner sets one',
      actual: [
        planOf([...review, '--', 'Review PR #61'], true),
        planOf([...task, ...spawn], true),
        planOf(['--cap', '5', ...spawn], false),
        planOf([...review, '--cap', '4', '--', 'Review'], false),
      ],
      expected: [
        ['reviewer', undefined, 'wt-8zirdrl0'],
        ['builder', 3, undefined],
        ['builder', 5, undefined],
        ['reviewer', 4, 'wt-8zirdrl0'],
      ],
    });
  });
});

describe('activeCount', () => {
  const status = {
    worktrees: [
      {
        path: '/a',
        agents: {
          x: { status: 'running', agentType: 'claude' },
          r1: { status: 'running', agentType: 'claude' },
          r2: { status: 'exited', agentType: 'claude' },
        },
      },
    ],
  };
  const roleOf = (agentId: string) =>
    agentId.startsWith('r') ? ('reviewer' as const) : undefined;

  test('counts reviewers against their own cap', () => {
    assert({
      given: 'an unregistered builder, a running reviewer and a stopped one',
      should: 'count one builder and one reviewer',
      actual: [
        activeCount(status, roleOf, 'builder'),
        activeCount(status, roleOf, 'reviewer'),
      ],
      expected: [1, 1],
    });
  });
});

describe('activeCount for builders', () => {
  test('counts every running coding agent not registered as a reviewer', () => {
    const status = {
      worktrees: [
        {
          path: '/a',
          agents: { x: { status: 'running', agentType: 'claude' } },
        },
        {
          path: '/b',
          agents: {
            y: { status: 'running', agentType: 'claude' },
            z: { status: 'running', agentType: 'terminal' },
          },
        },
        { path: '/c', agents: { w: { status: 'exited', agentType: 'codex' } } },
        {
          path: '/d',
          agents: { v: { status: 'running', agentType: 'claude' } },
        },
        {
          path: '/e',
          agents: { u: { status: 'running', agentType: 'claude' } },
        },
      ],
    };
    assert({
      given:
        'builders, a reviewer, a terminal, a stopped agent and an unregistered agent from a raw pu spawn',
      should: 'count the builders and the unregistered agent',
      actual: activeCount(
        status,
        (agentId) =>
          agentId === 'v'
            ? 'reviewer'
            : agentId === 'u'
              ? undefined
              : 'builder',
        'builder',
      ),
      expected: 3,
    });
  });
});

describe('bun agent:spawn for a reviewer', () => {
  test('joins the existing worktree and is not blocked by the builder cap', async () => {
    const machine = fakeMachine({ builders: 3, reviewers: 1 });
    const code = await spawnAgent(working(machine), reviewArgs('wt-b0'));
    assert({
      given:
        'an agent spawning a reviewer for wt-b0 with the builder cap full and one reviewer running',
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
