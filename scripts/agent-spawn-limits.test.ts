import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { spawnAgent, type SpawnDeps } from './agent-spawn';
import { parseSpawnArgs, projectDir } from './agent-spawn-model';
import {
  fakeMachine,
  spawnArgs,
  spawned,
  userLine,
  reviewArgs,
  working,
} from './agent-spawn.test-support';

setupRitewayBun();

describe('agent:spawn role caps (ADR 0035 section 8)', () => {
  test('spawns any number of reviewers: the role has no cap', async () => {
    const machine = fakeMachine({ builders: 1, reviewers: 50 });
    const code = await spawnAgent(working(machine), reviewArgs('wt-b0'));
    assert({
      given: '50 reviewers already running against the same worktree',
      should: 'spawn the 51st without a cap refusal',
      actual: [code, spawned(machine.calls).length],
      expected: [0, 1],
    });
  });

  test('still refuses a 4th builder at its default cap of 3', async () => {
    const machine = fakeMachine({ builders: 3 });
    const code = await spawnAgent(machine.deps, spawnArgs);
    assert({
      given: '3 active builders and no --cap',
      should: 'refuse a 4th builder',
      actual: [
        code,
        spawned(machine.calls).length,
        machine.output.join('').includes('3 builders are active; the cap is 3'),
      ],
      expected: [1, 0, true],
    });
  });
});

describe('agent:spawn pu flags', () => {
  test('refuses pu flags that choose the worktree or root behind the wrapper', () => {
    const errorOf = (flag: string[]) => {
      const parsed = parseSpawnArgs(
        ['--task', 'tmzz7plnnrlz21d6qyyjp8sq', '--', '-n', 'x', ...flag, 'p'],
        true,
      );
      return 'error' in parsed ? parsed.error.split('\n')[0] : 'ok';
    };
    assert({
      given: 'pu spawn -w, --worktree and --root after --',
      should:
        'refuse each: the wrapper picks the worktree and counts the agent',
      actual: [
        errorOf(['-w', 'wt-1']),
        errorOf(['--worktree', 'wt-1']),
        errorOf(['--root']),
      ],
      expected: Array(3).fill(
        'pu spawn -w, --worktree and --root are chosen by agent:spawn: a reviewer uses --worktree before --',
      ),
    });
  });
});

describe('agent:spawn failure paths', () => {
  test('refuses to spawn when pu status fails during the cap check', async () => {
    const machine = fakeMachine();
    const failing: SpawnDeps = {
      ...machine.deps,
      run: (args, cwd) =>
        args.slice(0, 2).join(' ') === 'pu status'
          ? { code: 1, stdout: '' }
          : machine.deps.run(args, cwd),
    };
    assert({
      given: 'pu status exiting non-zero',
      should: 'exit 1 without spawning and say why',
      actual: [
        await spawnAgent(failing, spawnArgs),
        spawned(machine.calls).length,
        machine.output.join('').includes('pu status failed'),
      ],
      expected: [1, 0, true],
    });
  });

  test('counts earlier transcript turns before a reviewer joins a worktree', async () => {
    const machine = fakeMachine({ builders: 1 });
    const prompt = 'Review PR #61';
    const earlier = `${projectDir('/home', '/repo/.pu/worktrees/wt-b0')}/old.jsonl`;
    const deps: SpawnDeps = {
      ...machine.deps,
      list: (dir) => (earlier.startsWith(`${dir}/`) ? [earlier] : []),
      read: (path) =>
        path === earlier ? userLine(prompt) : machine.deps.read(path),
    };
    await spawnAgent(deps, [
      '--role',
      'reviewer',
      '--worktree',
      'wt-b0',
      '--',
      prompt,
    ]);
    assert({
      given: 'a worktree whose transcript already holds the same prompt',
      should: 'not count the old turn as the new one, and nudge',
      actual: machine.calls.some(
        (call) => call[1] === 'send' && call[3] === '',
      ),
      expected: true,
    });
  });
});
