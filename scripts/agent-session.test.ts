import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseBoardArgs } from './board-model';
import { mainCheckoutOf, sessionIsAgent } from './agent-session';

setupRitewayBun();

const git = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(['git', ...args], { cwd, stdout: 'ignore', stderr: 'ignore' });
const record = JSON.stringify({
  parent: null,
  role: 'builder',
  worktree: '/w',
});
const TASK = 'cf1oms2brtxmhszvrn3qawk8';

let root = '';
let main = '';
let worktree = '';
let stray = '';

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-session-')));
  main = join(root, 'main');
  worktree = join(root, 'wt');
  stray = join(root, 'not-a-repo');
  mkdirSync(main);
  mkdirSync(stray);
  git(main, 'init', '-q', '-b', 'main');
  git(
    main,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'x',
  );
  git(main, 'worktree', 'add', '-q', worktree);
  const agents = join(main, '.pu/daisy/agents');
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(agents, 'ag-builder.json'), record);
  writeFileSync(join(agents, 'ag-broken.json'), '{nope');
  mkdirSync(join(agents, 'ag-dir.json'));
  // A forged record inside the worktree must not count.
  mkdirSync(join(worktree, '.pu/daisy/agents'), { recursive: true });
  writeFileSync(join(worktree, '.pu/daisy/agents/ag-forged.json'), record);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const isAgent = (env: Record<string, string>, cwd = worktree) =>
  sessionIsAgent(env, mainCheckoutOf(cwd));
const doneRefused = (autonomous: boolean) =>
  'error' in parseBoardArgs(['status', TASK, 'completed'], autonomous);

describe('who is an agent, against real registry files', () => {
  test('finds the main checkout from a worktree', () => {
    assert({
      given: 'a worktree of a repository',
      should: 'name the main checkout, and nothing outside a repository',
      actual: [mainCheckoutOf(worktree), mainCheckoutOf(stray)],
      expected: [main, undefined],
    });
  });

  test('a registered builder is an agent and cannot mark Done', () => {
    const agent = isAgent({ PU_AGENT_ID: 'ag-builder' });
    assert({
      given: 'PU_AGENT_ID with a registration in the main checkout',
      should: 'be an agent and be refused board status completed',
      actual: [agent, doneRefused(agent)],
      expected: [true, true],
    });
  });

  test('the owner orchestrator, unregistered, may mark Done', () => {
    const agent = isAgent({ PU_AGENT_ID: 'ag-owner-orchestrator' });
    assert({
      given: 'PU_AGENT_ID with no registration',
      should: 'be the owner and be allowed board status completed',
      actual: [agent, doneRefused(agent)],
      expected: [false, false],
    });
  });

  test('DAISY_AUTONOMOUS=1 is an agent whatever the registry says', () => {
    assert({
      given: 'DAISY_AUTONOMOUS=1 with no id, and with an unregistered id',
      should: 'be an agent both times',
      actual: [
        isAgent({ DAISY_AUTONOMOUS: '1' }),
        isAgent({
          DAISY_AUTONOMOUS: '1',
          PU_AGENT_ID: 'ag-owner-orchestrator',
        }),
      ],
      expected: [true, true],
    });
  });

  test('fails closed on a malformed, unreadable or unlocatable registry', () => {
    assert({
      given:
        'a malformed record, a record that is a directory, no git repository, and a bad id',
      should: 'be an agent each time',
      actual: [
        isAgent({ PU_AGENT_ID: 'ag-broken' }),
        isAgent({ PU_AGENT_ID: 'ag-dir' }),
        isAgent({ PU_AGENT_ID: 'ag-builder' }, stray),
        isAgent({ PU_AGENT_ID: '../ag-builder' }),
      ],
      expected: [true, true, true, true],
    });
  });

  test('reads the main checkout, not the worktree (negative control)', () => {
    assert({
      given: 'a record forged inside the worktree only',
      should: 'not make it an agent: the worktree copy is not the registry',
      actual: isAgent({ PU_AGENT_ID: 'ag-forged' }),
      expected: false,
    });
  });
});
