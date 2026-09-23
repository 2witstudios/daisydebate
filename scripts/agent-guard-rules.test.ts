import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { classifyCommand, classifyFileEdit } from './agent-guard';
import {
  decide,
  facts,
  main,
  other,
  owner,
  worktree,
} from './agent-guard.test-support';

setupRitewayBun();

describe('agent guard: kill commands', () => {
  test('refuses kill commands not scoped to the worktree', () => {
    assert({
      given: 'unscoped pkill and killall, a foreign pid, and unknown pids',
      should: 'deny each one',
      actual: [
        'pkill -f next-server',
        'pkill node',
        'killall bun',
        'kill 202',
        'kill -9 303',
        'kill $(lsof -ti :3000)',
        'lsof -ti :3000 | xargs kill',
        'kill -9 -1',
      ].map((command) => decide(command)),
      expected: Array(8).fill('deny'),
    });
  });

  test('allows kill commands scoped to the worktree', () => {
    assert({
      given: 'a pkill pattern naming the worktree and a pid it owns',
      should: 'allow both',
      actual: [
        decide(`pkill -f "${worktree}/node_modules/.bin/next"`),
        decide('kill 101'),
        decide('kill %1'),
      ],
      expected: ['allow', 'allow', 'allow'],
    });
  });

  test('leaves owner sessions free to kill', () => {
    assert({
      given: 'an owner session running pkill',
      should: 'allow it',
      actual: decide('pkill -f next-server', owner()),
      expected: 'allow',
    });
  });
});

describe('agent guard: stacks the agent does not own', () => {
  test('refuses Docker cleanup that reaches other stacks', () => {
    assert({
      given: 'prunes, and removals of containers and volumes it does not own',
      should: 'deny each one',
      actual: [
        'docker system prune -af',
        'docker volume prune -f',
        'docker container prune',
        'docker rm -f daisy-other-postgres-1',
        'docker volume rm daisy_postgres-data',
        'docker rm -f $(docker ps -aq)',
        'docker compose -p daisy down -v',
        'docker compose -f infra/compose.yaml down',
      ].map((command) => decide(command)),
      expected: Array(8).fill('deny'),
    });
  });

  test('allows cleanup of its own stack', () => {
    assert({
      given: 'removals and compose down scoped to the owned stack',
      should: 'allow them',
      actual: [
        decide('docker rm -f daisy-mine-postgres-1'),
        decide('docker volume rm daisy-mine_postgres-data'),
        decide('docker compose -p daisy-mine down'),
        decide('docker compose --env-file .env -f infra/compose.yaml down'),
      ],
      expected: ['allow', 'allow', 'allow', 'allow'],
    });
  });

  test('refuses infra:down and db:reset against a stack it does not own', () => {
    assert({
      given: 'another checkout, an overridden stack, and a shared stack',
      should: 'deny each one',
      actual: [
        decide(`cd ${other} && bun infra:down`),
        decide('DAISY_STACK_NAME=daisy bun infra:down'),
        decide(`bun --cwd ${main} run infra:down`),
        decide(
          'bun db:reset',
          facts({ stackOf: () => 'daisy', databaseOf: () => 'daisy' }),
        ),
        decide(`cd ${main} && bun db:reset`),
        decide('DATABASE_URL=postgres://h/daisy bun db:reset'),
        decide('bun infra:down', facts({ stackOf: () => 'daisy' })),
      ],
      expected: Array(7).fill('deny'),
    });
  });

  test('allows infra:down and db:reset on its own stack', () => {
    assert({
      given: 'the agent worktree with its own stack and database',
      should: 'allow both',
      actual: [decide('bun infra:down'), decide('bun run db:reset')],
      expected: ['allow', 'allow'],
    });
  });

  test('leaves owner sessions free to manage stacks', () => {
    assert({
      given: 'an owner session pruning Docker',
      should: 'allow it',
      actual: decide('docker system prune -af', owner()),
      expected: 'allow',
    });
  });
});

describe('agent guard: loop state and guard bypasses', () => {
  test('refuses an autonomous agent ending or restarting its own loop by hand', () => {
    assert({
      given: 'removal, move, truncation and in-place edits of loop state',
      should: 'deny each one',
      actual: [
        'rm .claude/ralph-loop.local.md',
        'rm -f .claude/ralph-loop.escalated.md',
        'mv .claude/ralph-loop.escalated.md .claude/ralph-loop.local.md',
        ': > .claude/ralph-loop.local.md',
        "sed -i '' 's/iteration: .*/iteration: 1/' .claude/ralph-loop.local.md",
        'truncate -s 0 .claude/ralph-loop.local.md',
      ].map((command) => decide(command)),
      expected: Array(6).fill('deny'),
    });
  });

  test('allows reading loop state', () => {
    assert({
      given: 'reads of the loop state file',
      should: 'allow them',
      actual: [
        decide('head -10 .claude/ralph-loop.local.md'),
        decide('test -f .claude/ralph-loop.local.md && echo EXISTS'),
      ],
      expected: ['allow', 'allow'],
    });
  });

  test('refuses clearing the autonomous marker', () => {
    assert({
      given: 'commands that unset or override DAISY_AUTONOMOUS or PU_AGENT_ID',
      should: 'deny each one',
      actual: [
        'DAISY_AUTONOMOUS= git push origin main',
        'unset DAISY_AUTONOMOUS',
        'env -u DAISY_AUTONOMOUS gh pr merge 1',
        'PU_AGENT_ID=ag-parent bun loop:close ag-me "done"',
        'export DAISY_AUTONOMOUS=0',
      ].map((command) => decide(command)),
      expected: Array(5).fill('deny'),
    });
  });

  test('judges commands nested in shells and substitutions', () => {
    assert({
      given: 'dangerous commands inside bash -c, eval and $(...)',
      should: 'deny each one',
      actual: [
        decide(`bash -c 'git push origin main'`),
        decide(`eval "gh pr merge 3"`),
        decide('echo $(pkill node)'),
        decide('sudo killall node'),
      ],
      expected: ['deny', 'deny', 'deny', 'deny'],
    });
  });

  test('refuses file edits of loop state for an autonomous agent only', () => {
    assert({
      given: 'Edit and Write targets inside and outside the loop state',
      should: 'deny the loop state for an agent and allow everything else',
      actual: [
        classifyFileEdit(`${worktree}/.claude/ralph-loop.local.md`, facts())
          .decision,
        classifyFileEdit(`${worktree}/scripts/loop.ts`, facts()).decision,
        classifyFileEdit(`${worktree}/.claude/ralph-loop.local.md`, owner())
          .decision,
      ],
      expected: ['deny', 'allow', 'allow'],
    });
  });

  test('gives every refusal a reason', () => {
    const verdict = classifyCommand('git push origin main', facts());
    assert({
      given: 'a refused command',
      should: 'explain the refusal and the permitted path',
      actual: verdict.reason?.includes('gh pr merge --auto'),
      expected: true,
    });
  });
});
