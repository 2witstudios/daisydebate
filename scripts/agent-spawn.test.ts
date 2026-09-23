import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { recordPath, serializeRecord } from './agent-registry';
import { sendConfirmed, spawnAgent, type SpawnDeps } from './agent-spawn';
import {
  repo,
  newPath,
  transcript,
  fakeMachine,
  spawnArgs,
  spawned,
} from './agent-spawn.test-support';

setupRitewayBun();

describe('bun agent:spawn', () => {
  test('prepares the worktree before the prompt and records the parent', async () => {
    const machine = fakeMachine({ submitsOnSpawn: true });
    const code = await spawnAgent(machine.deps, spawnArgs);
    const order = machine.calls
      .filter((call) => call[0] !== 'pu' || call[1] === 'spawn')
      .map((call) =>
        call
          .filter((word) => !word.startsWith('@'))
          .slice(0, 3)
          .join(' '),
      );
    assert({
      given: 'a builder spawn under the cap',
      should:
        'check the leaf, create the worktree, install and bring the slot up, then send the prompt, and register the parent outside the worktree',
      actual: {
        code,
        order,
        setupInWorktree: machine.calls
          .filter((call) => call[0] === 'bun')
          .every((call) => call.at(-1) === `@${newPath}`),
        record: machine.files.get(recordPath(repo, 'ag-new')),
        inWorktree: [...machine.files.keys()].filter(
          (path) => path.startsWith(`${newPath}/`) && path !== transcript,
        ),
        promptSpawn: spawned(machine.calls)[1]?.slice(0, 6),
      },
      expected: {
        code: 0,
        order: [
          'pagespace pages read',
          'pu spawn -a',
          'bun install --frozen-lockfile',
          'bun slot:up',
          'pu spawn -w',
        ],
        setupInWorktree: true,
        record: serializeRecord({
          parent: 'ag-parent',
          role: 'builder',
          worktree: newPath,
        }),
        inWorktree: [],
        promptSpawn: ['pu', 'spawn', '-w', 'wt-new', '-a', 'claude'],
      },
    });
  });

  test('nudges with an empty send when the prompt was not submitted', async () => {
    const machine = fakeMachine({ submitsOnSpawn: false });
    const code = await spawnAgent(machine.deps, spawnArgs);
    assert({
      given: 'a child whose transcript shows no user turn',
      should: 'send an empty pu send and then confirm submission',
      actual: [
        code,
        machine.calls.find((call) => call[1] === 'send'),
        machine.output.some((line) => line.includes('prompt submitted')),
      ],
      expected: [0, ['pu', 'send', 'ag-new', ''], true],
    });
  });

  test('sends no prompt when setup fails', async () => {
    const machine = fakeMachine({ setupFails: true });
    const code = await spawnAgent(machine.deps, spawnArgs);
    assert({
      given: 'bun install failing in the new worktree',
      should: 'stop before the agent spawn',
      actual: [code, spawned(machine.calls).length],
      expected: [1, 1],
    });
  });

  test('refuses a new builder at the cap unless the owner overrides', async () => {
    const agent = fakeMachine({ builders: 3 });
    const agentOverride = fakeMachine({ builders: 3 });
    const owner = fakeMachine({
      builders: 3,
      autonomous: false,
      submitsOnSpawn: true,
    });
    assert({
      given:
        'three active builders, an agent, an agent override, an owner override',
      should: 'refuse the agent twice and let the owner through',
      actual: [
        await spawnAgent(agent.deps, spawnArgs),
        spawned(agent.calls).length,
        await spawnAgent(agentOverride.deps, ['--override', ...spawnArgs]),
        await spawnAgent(owner.deps, ['--override', ...spawnArgs]),
      ],
      expected: [1, 0, 1, 0],
    });
  });

  test('refuses a leaf with no Related pages and a prompt with a superseded term', async () => {
    const bare = fakeMachine({ leaf: '<p>Given X, should Y</p>' });
    const stalePrompt = fakeMachine();
    const results = [
      await spawnAgent(bare.deps, spawnArgs),
      await spawnAgent(stalePrompt.deps, [
        ...spawnArgs.slice(0, -1),
        'Seed the users with stable UUIDs',
      ]),
    ];
    assert({
      given:
        'a leaf without a Related pages section, and a clean leaf whose prompt says UUIDs',
      should: 'refuse both and name the reason',
      actual: [
        results,
        bare.output.join('').includes('no Related pages section'),
        stalePrompt.output.join('').includes('superseded by ADR 0018'),
      ],
      expected: [[1, 1], true, true],
    });
  });

  test('counts builders that bypassed the wrapper toward the cap', async () => {
    const machine = fakeMachine({ builders: 3, unregistered: true });
    assert({
      given:
        'three running agents from a raw pu spawn, with no registry record',
      should: 'refuse a fourth builder',
      actual: await spawnAgent(machine.deps, spawnArgs),
      expected: 1,
    });
  });

  test('refuses a builder for a leaf with unmerged prerequisites or superseded terms', async () => {
    const prerequisite = fakeMachine({
      leaf: '<h3>\nRelated pages\n</h3>\n<ul>\n<li>\nPrerequisite: PR #50\n</li>\n</ul>',
    });
    const stale = fakeMachine({ leaf: '<p>Seeds use stable UUIDs.</p>' });
    const results = [
      await spawnAgent(prerequisite.deps, spawnArgs),
      await spawnAgent(stale.deps, spawnArgs),
    ];
    assert({
      given: 'an open prerequisite PR, and a leaf still saying UUIDs',
      should: 'refuse both and name the reason',
      actual: [
        results,
        prerequisite.output.join('').includes('PR #50 is not merged'),
        stale.output.join('').includes('superseded by ADR 0018'),
      ],
      expected: [[1, 1], true, true],
    });
  });
});

describe('bun agent:send', () => {
  test('confirms a send by transcript growth and nudges when it did not grow', async () => {
    const machine = fakeMachine({ submitsOnSpawn: true });
    await spawnAgent(machine.deps, spawnArgs);
    machine.calls.length = 0;
    const code = await sendConfirmed(machine.deps, 'ag-new', 'status?');
    assert({
      given: 'a text send to a running child',
      should: 'send, then count it submitted once a new user turn appears',
      actual: [
        code,
        machine.calls
          .filter((call) => call[1] === 'send')
          .map((call) => call[3]),
      ],
      expected: [0, ['status?']],
    });
  });

  test('confirms by activity when the session writes no transcript', () =>
    (async () => {
      const machine = fakeMachine({ submitsOnSpawn: true });
      await spawnAgent(machine.deps, spawnArgs);
      machine.files.clear();
      machine.calls.length = 0;
      // Quiet for 5 s before the send, then writing.
      let polls = 0;
      const working = {
        ...machine.deps,
        idleOf: () => (polls++ === 0 ? 5 : 0),
      };
      const code = await sendConfirmed(working, 'ag-new', 'status?');
      assert({
        given:
          'no transcript on disk, a quiet terminal before the send and one still writing after it',
        should: 'count the text as submitted without a nudge',
        actual: [
          code,
          machine.calls.filter((call) => call[1] === 'send').length,
        ],
        expected: [0, 1],
      });
    })());

  test('nudges a busy agent and fails when nothing confirms the text', () =>
    (async () => {
      const machine = fakeMachine({ submitsOnSpawn: true });
      await spawnAgent(machine.deps, spawnArgs);
      machine.files.clear();
      machine.calls.length = 0;
      // pu takes the sends, but no user turn ever appears.
      const busy: SpawnDeps = {
        ...machine.deps,
        idleOf: () => 0,
        run: (args, cwd) => {
          if (args[1] !== 'send') return machine.deps.run(args, cwd);
          machine.calls.push([...args]);
          return { code: 0, stdout: '' };
        },
      };
      const code = await sendConfirmed(busy, 'ag-new', 'status?');
      assert({
        given:
          'an agent writing before and after the send, and no transcript growth even after the nudge',
        should: 'send, nudge once, and report the text as not confirmed',
        actual: [
          code,
          machine.calls
            .filter((call) => call[1] === 'send')
            .map((call) => call[3]),
        ],
        expected: [1, ['status?', '']],
      });
    })());
});
