import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  activeBuilders,
  findPrerequisites,
  parseSpawnArgs,
  prerequisiteBlockers,
  supersededTerms,
  activeAfterSend,
  agentCwd,
  projectDir,
  userTurnsWith,
} from './agent-spawn-model';

setupRitewayBun();

describe('parseSpawnArgs', () => {
  test('splits wrapper options from pu spawn arguments', () => {
    assert({
      given:
        'wrapper flags, then pu spawn flags with --agent-args as two words',
      should:
        'return the wrapper options, the worktree name, base and agent, and the rest in = form',
      actual: parseSpawnArgs([
        '--task',
        'tmzz7plnnrlz21d6qyyjp8sq',
        '--role',
        'reviewer',
        '--',
        '-n',
        'grd-7',
        '-b',
        'main',
        '-a',
        'codex',
        '--agent-args',
        '--model x',
        'Run the prompt',
      ]),
      expected: {
        task: 'tmzz7plnnrlz21d6qyyjp8sq',
        role: 'reviewer',
        override: false,
        cap: 3,
        name: 'grd-7',
        base: 'main',
        agent: 'codex',
        rest: ['--agent-args=--model x', 'Run the prompt'],
      },
    });
  });

  test('defaults to a claude builder under the cap of 3', () => {
    const parsed = parseSpawnArgs(['--', '--name', 'x', 'prompt']);
    assert({
      given: 'only a name and a prompt',
      should: 'use the defaults',
      actual:
        'error' in parsed
          ? parsed.error
          : [parsed.role, parsed.agent, parsed.cap, parsed.base],
      expected: ['builder', 'claude', 3, 'main'],
    });
  });

  test('refuses a spawn without a name or with a bad role', () => {
    assert({
      given: 'no --name, and an unknown role',
      should: 'return errors',
      actual: [
        'error' in parseSpawnArgs(['--', 'prompt']),
        'error' in parseSpawnArgs(['--role', 'boss', '--', '-n', 'x', 'p']),
      ],
      expected: [true, true],
    });
  });
});

describe('parseSpawnArgs for an autonomous agent', () => {
  const task = ['--task', 'tmzz7plnnrlz21d6qyyjp8sq'];
  const spawn = ['--', '-n', 'x', 'prompt'];
  const errorOf = (argv: string[], autonomous: boolean) => {
    const parsed = parseSpawnArgs(argv, autonomous);
    return 'error' in parsed ? parsed.error.split('\n')[0] : 'ok';
  };

  test('refuses the cap and role overrides and a builder without a leaf', () => {
    assert({
      given: 'an autonomous --cap, --role, and a spawn without --task',
      should: 'refuse each, naming the owner',
      actual: [
        errorOf([...task, '--cap', '99', ...spawn], true),
        errorOf([...task, '--role', 'reviewer', ...spawn], true),
        errorOf(spawn, true),
      ],
      expected: [
        'Only the owner can pass --cap.',
        'Only the owner can pass --role.',
        'An autonomous agent spawns a builder only for a leaf: pass --task <leafPageId>.',
      ],
    });
  });

  test('accepts the same options from the owner and a leaf spawn from an agent', () => {
    assert({
      given:
        'the owner with --cap and --role and no task, and an agent with --task',
      should: 'accept both',
      actual: [
        errorOf(['--cap', '5', '--role', 'reviewer', ...spawn], false),
        errorOf([...task, ...spawn], true),
      ],
      expected: ['ok', 'ok'],
    });
  });
});

describe('activeBuilders', () => {
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
      actual: activeBuilders(status, (agentId) =>
        agentId === 'v' ? 'reviewer' : agentId === 'u' ? undefined : 'builder',
      ),
      expected: 3,
    });
  });
});

describe('prerequisites', () => {
  const leaf = [
    '<ul>',
    '<li>',
    'Given X, should Y',
    '</li>',
    '</ul>',
    '<h3>',
    'Related pages',
    '</h3>',
    '<ul>',
    '<li>',
    'Plan: <a class="mention" data-mention-type="page" data-page-id="plan1">@Plan</a>',
    '</li>',
    '<li>',
    'Prerequisite: <a class="mention" data-mention-type="page" data-page-id="leaf2">@PAR-2</a> (PR #50) and ADR 0034',
    '</li>',
    '</ul>',
  ].join('\n');

  test('reads the declared prerequisites from Related pages', () => {
    assert({
      given: 'a leaf with a Prerequisite line naming a leaf, a PR and an ADR',
      should: 'return each prerequisite and ignore other related pages',
      actual: findPrerequisites(leaf),
      expected: { leaves: ['leaf2'], prs: [50], adrs: ['0034'] },
    });
  });

  test('reads only the list under the Related pages heading', () => {
    const outside = [
      '<p>Prerequisite: PR #7 was discussed in the body</p>',
      leaf,
      '<p>Notes after the list. Prerequisite: ADR 0001</p>',
    ].join('\n');
    assert({
      given: 'Prerequisite text in the body and after the Related pages list',
      should: 'return only the prerequisites inside the list',
      actual: findPrerequisites(outside),
      expected: { leaves: ['leaf2'], prs: [50], adrs: ['0034'] },
    });
  });

  test('fails closed when the leaf has no Related pages heading', () => {
    assert({
      given: 'a leaf with criteria but no Related pages section',
      should: 'return undefined so the spawn is refused',
      actual: findPrerequisites('<ul><li>Given X, should Y</li></ul>'),
      expected: undefined,
    });
  });

  test('blocks the builder until every prerequisite is merged', () => {
    const prerequisites = findPrerequisites(leaf) ?? {
      leaves: [],
      prs: [],
      adrs: [],
    };
    assert({
      given:
        'an open PR, a missing ADR and an unfinished leaf, then all merged',
      should: 'name each blocker, then none',
      actual: [
        prerequisiteBlockers(prerequisites, {
          prMerged: () => false,
          adrMerged: () => false,
          leafStatus: () => 'in_progress',
        }),
        prerequisiteBlockers(prerequisites, {
          prMerged: () => true,
          adrMerged: () => true,
          leafStatus: () => 'merged',
        }),
      ],
      expected: [
        [
          'leaf leaf2 is in_progress, not merged',
          'PR #50 is not merged',
          'ADR 0034 is not on origin/main',
        ],
        [],
      ],
    });
  });
});

describe('supersededTerms', () => {
  const table = [
    {
      pattern: '\\bUUIDs?\\b',
      term: 'UUID',
      adr: '0018',
      use: 'cuid2 identifiers',
    },
  ];

  test('flags terms a merged ADR superseded', () => {
    assert({
      given: 'a leaf that still says stable UUIDs',
      should: 'flag the term with its ADR and replacement',
      actual: supersededTerms('Seeds should use stable UUIDs.', table),
      expected: ['"UUIDs" was superseded by ADR 0018: use cuid2 identifiers'],
    });
    assert({
      given: 'a leaf that uses the current term',
      should: 'flag nothing',
      actual: supersededTerms('Seeds use cuid2 identifiers.', table),
      expected: [],
    });
  });
});

describe('transcripts', () => {
  test('locates the Claude Code projects directory of a working directory', () => {
    assert({
      given: 'a worktree path',
      should: 'use the directory naming Claude Code writes',
      actual: projectDir('/Users/me', '/Users/me/repo/.pu/worktrees/wt-1'),
      expected: '/Users/me/.claude/projects/-Users-me-repo--pu-worktrees-wt-1',
    });
  });

  test('counts user turns that carry the sent text', () => {
    const lines = [
      '{"type":"mode","mode":"x"}',
      '{"type":"user","message":{"role":"user","content":"Run: pagespace pages read p1 \\"quoted\\""}}',
      'not json',
      '{"type":"assistant","message":{"content":"Run: pagespace pages read p1"}}',
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"other"}]}}',
    ].join('\n');
    assert({
      given:
        'a transcript with the text once as a user turn and once from the assistant',
      should: 'count only the user turn, and nothing for text never sent',
      actual: [
        userTurnsWith(lines, 'Run: pagespace pages read p1 "quoted"'),
        userTurnsWith(lines, 'never sent'),
      ],
      expected: [1, 0],
    });
  });
});

describe('agentCwd', () => {
  const status = {
    worktrees: [{ path: '/repo/.pu/worktrees/wt-1', agents: { 'ag-w': {} } }],
    agents: [{ id: 'ag-root', worktree_id: null }],
  };

  test('finds worktree agents and root agents', () => {
    assert({
      given: 'pu status with a worktree agent and a root agent',
      should: 'return the worktree path, the main checkout, or undefined',
      actual: [
        agentCwd(status, 'ag-w', '/repo'),
        agentCwd(status, 'ag-root', '/repo'),
        agentCwd(status, 'ag-none', '/repo'),
      ],
      expected: ['/repo/.pu/worktrees/wt-1', '/repo', undefined],
    });
  });
});

describe('activeAfterSend', () => {
  test('counts output seconds after the send as the agent working', () => {
    assert({
      given:
        'a session still writing 4 s after the send, one that only echoed the text, and one pu cannot measure',
      should: 'confirm only the working session',
      actual: [
        activeAfterSend(5, [
          { at: 1, idle: 0 },
          { at: 4, idle: 0 },
        ]),
        activeAfterSend(5, [
          { at: 1, idle: 0 },
          { at: 4, idle: 3 },
          { at: 8, idle: 7 },
        ]),
        activeAfterSend(5, [{ at: 5, idle: null }]),
      ],
      expected: [true, false, false],
    });
  });

  test('does not count an agent that was already busy before the send', () => {
    const writing = [
      { at: 1, idle: 0 },
      { at: 4, idle: 0 },
    ];
    assert({
      given:
        'output after the send from an agent silent under 2 s before it, and from one pu could not measure before it',
      should: 'confirm neither: the output may be its earlier work',
      actual: [activeAfterSend(1, writing), activeAfterSend(null, writing)],
      expected: [false, false],
    });
  });
});
