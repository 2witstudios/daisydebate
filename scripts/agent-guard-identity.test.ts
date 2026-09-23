import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { classifyPush } from './agent-guard';
import { decide, facts } from './agent-guard.test-support';

setupRitewayBun();

describe('agent guard: a pu agent without its identity', () => {
  const misconfigured = facts({ autonomous: false, misconfigured: true });

  test('refuses network git and gh until it is restarted through the launcher', () => {
    assert({
      given:
        'a resumed agent running push, fetch, clone, gh and a local git command',
      should: 'deny the network commands and allow the local one',
      actual: [
        'git push origin pu/mine',
        'git fetch origin',
        'git clone https://github.com/o/r',
        'gh pr view 1',
        'git status',
      ].map((command) => decide(command, misconfigured)),
      expected: ['deny', 'deny', 'deny', 'deny', 'allow'],
    });
  });

  test('refuses the plumbing commands that reach a remote too', () => {
    assert({
      given:
        'git send-pack, fetch-pack and archive --remote, and a local archive',
      should: 'deny the remote ones and allow the local one',
      actual: [
        'git send-pack git@github.com:o/r main',
        'git fetch-pack https://github.com/o/r',
        'git archive --remote=git@github.com:o/r HEAD',
        'git archive HEAD',
      ].map((command) => decide(command, misconfigured)),
      expected: ['deny', 'deny', 'deny', 'allow'],
    });
  });

  test('applies every agent rule, not the owner ones', () => {
    assert({
      given: 'a direct merge and an unscoped kill',
      should: 'deny, as for any agent',
      actual: [
        decide('pkill node', misconfigured),
        decide('rm .claude/ralph-loop.local.md', misconfigured),
      ],
      expected: ['deny', 'deny'],
    });
  });
});

describe('agent guard: pushes from a pu agent without its identity', () => {
  test('refuses every push in the pre-push hook', () => {
    assert({
      given: 'a branch push from a misconfigured agent',
      should: 'deny it',
      actual: classifyPush(
        [
          `refs/heads/pu/mine ${'a'.repeat(40)} refs/heads/pu/mine ${'0'.repeat(40)}`,
        ],
        facts({ autonomous: false, misconfigured: true }),
      ).decision,
      expected: 'deny',
    });
  });
});

describe('agent guard: the identity regime through the real hook', () => {
  const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
  const hook = (projectRoot: string, command: string) => {
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.GH_TOKEN;
    delete env.DAISY_AUTONOMOUS;
    const run = Bun.spawnSync(['bun', 'scripts/agent-guard.ts', 'hook'], {
      cwd: root,
      env: {
        ...env,
        CLAUDE_PROJECT_DIR: root,
        PU_PROJECT_ROOT: projectRoot,
        PU_AGENT_ID: 'ag-resumed',
      },
      stdin: Buffer.from(
        JSON.stringify({
          cwd: root,
          tool_name: 'Bash',
          tool_input: { command },
        }),
      ),
    });
    return run.stdout.toString().includes('"deny"') ? 'deny' : 'silent';
  };

  test("follows the owner's file in the project root, not the worktree copy", () => {
    const active = mkdtempSync(`${tmpdir()}/grd-6-regime-`);
    writeFileSync(`${active}/.env.agent`, 'GH_TOKEN=x\n');
    const inactive = mkdtempSync(`${tmpdir()}/grd-6-regime-`);
    assert({
      given:
        'a resumed agent with no GH_TOKEN, under a project root with and without the owner .env.agent (this worktree has no copy)',
      should: 'refuse gh only when the regime is active',
      actual: [hook(active, 'gh pr view 1'), hook(inactive, 'gh pr view 1')],
      expected: ['deny', 'silent'],
    });
  });
});
