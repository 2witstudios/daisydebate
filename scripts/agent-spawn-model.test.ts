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

describe('activeBuilders', () => {
  test('counts running builder agents only', () => {
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
      ],
    };
    assert({
      given: 'builders, a reviewer, a terminal and a stopped agent',
      should: 'count running non-terminal agents in builder worktrees',
      actual: activeBuilders(status, (agentId) =>
        agentId === 'v' ? 'reviewer' : 'builder',
      ),
      expected: 2,
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

  test('blocks the builder until every prerequisite is merged', () => {
    const prerequisites = findPrerequisites(leaf);
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
        activeAfterSend([
          { at: 1, idle: 0 },
          { at: 4, idle: 0 },
        ]),
        activeAfterSend([
          { at: 1, idle: 0 },
          { at: 4, idle: 3 },
          { at: 8, idle: 7 },
        ]),
        activeAfterSend([{ at: 5, idle: null }]),
      ],
      expected: [true, false, false],
    });
  });
});
