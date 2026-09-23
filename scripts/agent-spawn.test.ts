import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { recordPath, serializeRecord } from './agent-registry';
import { sendConfirmed, spawnAgent, type SpawnDeps } from './agent-spawn';

setupRitewayBun();

const repo = '/repo';
const newPath = '/repo/.pu/worktrees/wt-new';
const projects = '/home/.claude/projects/-repo--pu-worktrees-wt-new';
const transcript = `${projects}/sess-new.jsonl`;
const userLine = (text: string) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const leafId = 'tmzz7plnnrlz21d6qyyjp8sq';
const terms = JSON.stringify([
  { pattern: '\\bUUIDs?\\b', term: 'UUID', adr: '0018', use: 'cuid2' },
]);

type World = {
  worktrees: {
    id: string;
    path: string;
    branch: string;
    agents: Record<string, object>;
  }[];
};

function fakeMachine(
  options: {
    builders?: number;
    // Builders started by a raw pu spawn, with no registry record.
    unregistered?: boolean;
    leaf?: string;
    submitsOnSpawn?: boolean;
    setupFails?: boolean;
    autonomous?: boolean;
  } = {},
) {
  const world: World = {
    worktrees: Array.from({ length: options.builders ?? 0 }, (_, i) => ({
      id: `wt-b${i}`,
      path: `/repo/.pu/worktrees/wt-b${i}`,
      branch: `pu/b${i}`,
      agents: {
        [`ag-b${i}`]: {
          id: `ag-b${i}`,
          status: 'running',
          agentType: 'claude',
        },
      },
    })),
  };
  const files = new Map<string, string>([
    [`${repo}/policy/superseded-terms.json`, terms],
    ...(options.unregistered ? [] : world.worktrees).map(
      (w, i) =>
        [
          recordPath(repo, `ag-b${i}`),
          serializeRecord({
            parent: 'ag-parent',
            role: 'builder',
            worktree: w.path,
          }),
        ] as [string, string],
    ),
  ]);
  const calls: string[][] = [];
  const output: string[] = [];
  const run = (args: readonly string[], cwd?: string) => {
    calls.push([...args, ...(cwd ? [`@${cwd}`] : [])]);
    const key = args.slice(0, 2).join(' ');
    if (key === 'pu status') return { code: 0, stdout: JSON.stringify(world) };
    if (key === 'pu spawn' && args.includes('terminal')) {
      world.worktrees.push({
        id: 'wt-new',
        path: newPath,
        branch: `pu/${args[args.indexOf('-n') + 1]}`,
        agents: { 'ag-term': { id: 'ag-term', agentType: 'terminal' } },
      });
      return { code: 0, stdout: '' };
    }
    if (key === 'pu spawn') {
      const created = world.worktrees.find((w) => w.id === 'wt-new');
      if (created)
        created.agents['ag-new'] = {
          id: 'ag-new',
          agentType: 'claude',
          status: 'running',
          sessionId: 'sess-new',
        };
      files.set(
        transcript,
        options.submitsOnSpawn
          ? userLine(String(args.at(-1)))
          : '{"type":"mode"}',
      );
      return { code: 0, stdout: '' };
    }
    if (key === 'pu send') {
      // An empty send presses Enter on the prompt that sat unsubmitted.
      const text = args[3] === '' ? 'Run the task' : String(args[3]);
      files.set(
        transcript,
        `${files.get(transcript) ?? ''}\n${userLine(text)}`,
      );
      return { code: 0, stdout: '' };
    }
    if (args[0] === 'bun')
      return { code: options.setupFails ? 1 : 0, stdout: '' };
    if (key === 'pagespace pages')
      return {
        code: 0,
        stdout: JSON.stringify({ content: options.leaf ?? '<p>ok</p>' }),
      };
    return { code: 0, stdout: '' };
  };
  const deps: SpawnDeps = {
    run,
    read: (path) => files.get(path),
    list: (dir) =>
      dir === projects && files.has(transcript) ? [transcript] : [],
    mainCheckout: repo,
    write: (path, text) => void files.set(path, text),
    sleep: async () => undefined,
    // pu cannot measure idleness in the fake; transcripts decide.
    idleOf: () => null,
    home: '/home',
    repoRoot: repo,
    parentId: 'ag-parent',
    autonomous: options.autonomous ?? true,
    out: (text) => void output.push(text),
  };
  return { deps, calls, files, output };
}

const spawnArgs = [
  '--task',
  leafId,
  '--',
  '-n',
  'grd-9',
  '-a',
  'claude',
  'Run the task',
];
const spawned = (calls: string[][]) =>
  calls.filter((call) => call[0] === 'pu' && call[1] === 'spawn');

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
      const working = { ...machine.deps, idleOf: () => 0 };
      const code = await sendConfirmed(working, 'ag-new', 'status?');
      assert({
        given:
          'no transcript on disk but a terminal still writing after the send',
        should: 'count the text as submitted without a nudge',
        actual: [
          code,
          machine.calls.filter((call) => call[1] === 'send').length,
        ],
        expected: [0, 1],
      });
    })());
});
