import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { classifyCommand, classifyFileEdit } from './agent-guard';
import { isAgentSession } from './agent-guard-rules';
import { decide, facts, owner, worktree } from './agent-guard.test-support';

setupRitewayBun();

describe('agent guard: who is an agent', () => {
  test('treats a pu agent as an agent even without DAISY_AUTONOMOUS', () => {
    assert({
      given:
        'DAISY_AUTONOMOUS=1, PU_AGENT_ID alone (DAISY_AUTONOMOUS cleared), and neither',
      should: 'be an agent for the first two and the owner only for the last',
      actual: [
        isAgentSession({ DAISY_AUTONOMOUS: '1' }),
        isAgentSession({ PU_AGENT_ID: 'ag-1' }),
        isAgentSession({ PU_AGENT_ID: '' }),
      ],
      expected: [true, true, false],
    });
  });

  test('refuses every spelling that clears or unexports a guard variable', () => {
    assert({
      given: 'env -uVAR, env --unset=VAR, typeset +x and export -n',
      should: 'deny each',
      actual: [
        'env -uDAISY_AUTONOMOUS git push origin feature',
        'env --unset=PU_AGENT_ID bun loop:close ag-x done',
        'typeset +x DAISY_AUTONOMOUS',
        'export -n PU_AGENT_ID',
      ].map((command) => decide(command)),
      expected: Array(4).fill('deny'),
    });
  });
});

describe('agent guard: accident-class spellings', () => {
  test('refuses pkill that inverts or widens the match', () => {
    assert({
      given: 'pkill -v on the worktree, and a second pattern beside it',
      should: 'deny both and still allow a single worktree pattern',
      actual: [
        decide(`pkill -v -f "${worktree}"`),
        decide(`pkill -f bun "${worktree}"`),
        decide(`pkill -f "${worktree}/apps/web"`),
      ],
      expected: ['deny', 'deny', 'allow'],
    });
  });

  test('reads gh short-flag clusters, where a value flag swallows --auto', () => {
    assert({
      given: 'gh pr merge 1 -mb --auto (--auto is the body), and -m --auto',
      should: 'deny the first as a direct merge and allow the auto request',
      actual: [
        decide('gh pr merge 1 -mb --auto'),
        decide('gh pr merge 1 -m --auto'),
      ],
      expected: ['deny', 'allow'],
    });
  });

  test('reads the command of bash with options before or after -c, and of command -p and exec -a', () => {
    assert({
      given:
        'bash -O x -c, bash --rcfile f -c, bash -c -e, command -p and exec -a',
      should: 'judge the command each runs',
      actual: [
        'bash -O extglob -c "git push origin main"',
        'bash --rcfile f -c "git push origin main"',
        'bash -c -e "git push origin main"',
        'command -p gh pr merge 1 --merge',
        'exec -a x git push origin main',
      ].map((command) => decide(command)),
      expected: Array(5).fill('deny'),
    });
  });

  test('catches a push to main configured with git -c, and one-shot aliases and includes', () => {
    assert({
      given:
        'git -c remote.origin.push=HEAD:refs/heads/main push, git -c alias.p=… p, git -c include.path=… push',
      should: 'deny each',
      actual: [
        'git -c remote.origin.push=HEAD:refs/heads/main push origin',
        "git -c alias.p='push --no-verify origin HEAD:main' p",
        'git -c include.path=/tmp/cfg push origin feature',
      ].map((command) => decide(command)),
      expected: Array(3).fill('deny'),
    });
  });

  test('protects files named with ~, $HOME, $PWD or another letter case', () => {
    const home = facts({ home: '/repo/.pu/worktrees' });
    assert({
      given:
        'a case variant, ~, $HOME and $PWD spellings, and an Edit of a case variant',
      should: 'deny each',
      actual: [
        decide('rm .CLAUDE/ralph-loop.local.md'),
        decide('echo x > .Claude/Settings.json'),
        classifyCommand('rm ~/wt-mine/.claude/ralph-loop.local.md', home)
          .decision,
        classifyCommand('rm ${HOME}/wt-mine/.githooks/pre-push', home).decision,
        decide('rm "$PWD/.claude/ralph-loop.escalated.md"'),
        classifyFileEdit(`${worktree}/.CLAUDE/settings.json`, facts()).decision,
      ],
      expected: Array(6).fill('deny'),
    });
  });

  test('no longer over-blocks read-only finds, unrelated deletes and dotfile-free globs', () => {
    assert({
      given:
        'find -exec grep, find -name "*.tsbuildinfo" -delete, rm -rf *, and sed -i with an empty backup suffix',
      should: 'allow them: none can reach a protected file',
      actual: [
        decide(`find . -name "*.ts" -exec grep -l foo {} +`),
        decide(`find . -name "*.tsbuildinfo" -delete`),
        decide('rm -rf *'),
        decide("sed -i '' s/a/b/ scripts/x.ts"),
        decide('docker compose --parallel 1 down'),
      ],
      expected: ['allow', 'allow', 'allow', 'allow', 'deny'],
    });
  });

  test('keeps owner sessions unaffected', () => {
    assert({
      given: 'the owner running pkill -v and a git -c push to main',
      should: 'allow the kill and ask before the push',
      actual: [
        decide(`pkill -v -f "${worktree}"`, owner()),
        decide('git -c remote.origin.push=HEAD:main push origin', owner()),
      ],
      expected: ['allow', 'ask'],
    });
  });

  test('states the ruled merge condition when it refuses an API write to main', () => {
    const reason =
      classifyCommand(
        'gh api -X PUT repos/o/r/contents/x -f branch=main',
        facts(),
      ).reason ?? '';
    assert({
      given: 'a contents write to main through the API',
      should:
        'point at the conditional --auto request, not an unconditional one',
      actual: [
        reason.includes('once the live main ruleset requires review-record'),
        reason.includes('ready for owner merge'),
      ],
      expected: [true, true],
    });
  });
});
