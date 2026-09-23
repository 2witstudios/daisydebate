import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { classifyPush, hookResponse, terminalAnswer } from './agent-guard';
import { decide, facts, main, owner } from './agent-guard.test-support';

setupRitewayBun();

describe('agent guard: pushes to main', () => {
  test('refuses every autonomous push that targets main', () => {
    assert({
      given: 'explicit, HEAD, refs/heads, forced, delete and --all pushes',
      should: 'deny each one for an autonomous agent',
      actual: [
        'git push origin main',
        'git push origin HEAD:main',
        'git push origin +pu/mine:refs/heads/main',
        'git push --force origin main',
        'git push origin :main',
        'git push --delete origin main',
        'git push --all origin',
        'git push --mirror',
        'cd /repo && git push',
        'git -C /repo push',
      ].map((command) => decide(command)),
      expected: Array(10).fill('deny'),
    });
  });

  test('allows an autonomous push of its own branch', () => {
    assert({
      given: 'a push of the agent branch with and without an explicit ref',
      should: 'allow it',
      actual: [
        decide('git push'),
        decide('git push -u origin pu/mine'),
        decide('git push origin HEAD'),
      ],
      expected: ['allow', 'allow', 'allow'],
    });
  });

  test('refuses hook bypasses on an autonomous push', () => {
    assert({
      given: 'git push --no-verify and a hooksPath override',
      should: 'deny both, because the pre-push hook is the guard',
      actual: [
        decide('git push --no-verify origin pu/mine'),
        decide('git -c core.hooksPath=/dev/null push'),
      ],
      expected: ['deny', 'deny'],
    });
  });

  test('reads git option abbreviations and every destination form', () => {
    assert({
      given:
        'abbreviated --no-verify, --all and --mirror, and heads/, refs/heads/ and forced destinations',
      should: 'deny each one, as git would accept them',
      actual: [
        'git push --no-verif origin feature:heads/main',
        'git push --no-v origin feature',
        'git push --al origin',
        'git push --mir',
        'git push origin x:heads/main',
        'git push origin x:refs/heads/main',
        'git push origin +x:main',
        'git push --repo=origin x:main',
      ].map((command) => decide(command)),
      expected: Array(8).fill('deny'),
    });
  });

  test('refuses every way of pointing core.hooksPath away from the guard', () => {
    assert({
      given:
        'GIT_CONFIG_* and GIT_CONFIG_PARAMETERS in the environment, --config-env, an export and git config',
      should: 'deny each one',
      actual: [
        'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git push origin x',
        "GIT_CONFIG_PARAMETERS=\"'core.hooksPath'='/dev/null'\" git push",
        'git --config-env=core.hooksPath=EMPTY push origin x',
        'git --config-env core.hooksPath=EMPTY push origin x',
        'export GIT_CONFIG_KEY_0=core.hookspath',
        'git config core.hooksPath /dev/null',
        'git config --local core.hooksPath .nothing',
      ].map((command) => decide(command)),
      expected: Array(7).fill('deny'),
    });
  });

  test('asks the owner before a push to main', () => {
    assert({
      given: 'an owner session pushing main and pushing a branch',
      should: 'ask for main and allow the branch',
      actual: [
        decide('git push origin main', owner({ cwd: main })),
        decide('git push origin pu/mine', owner()),
      ],
      expected: ['ask', 'allow'],
    });
  });
});

describe('agent guard: merges', () => {
  test('refuses a direct autonomous merge and allows an auto-merge request', () => {
    assert({
      given: 'gh pr merge with and without --auto, and with --admin',
      should: 'allow only --auto without --admin',
      actual: [
        decide('gh pr merge 12 --merge'),
        decide('gh pr merge 12 --auto --merge'),
        decide('gh pr merge 12 --auto --admin'),
        decide('gh pr merge 12 --admin --merge'),
      ],
      expected: ['deny', 'allow', 'deny', 'deny'],
    });
  });

  test('refuses merging through the REST and GraphQL APIs', () => {
    assert({
      given: 'a PUT to the merge endpoint and a mergePullRequest mutation',
      should: 'deny both for an autonomous agent',
      actual: [
        decide('gh api -X PUT repos/o/r/pulls/12/merge'),
        decide(
          `gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }'`,
        ),
      ],
      expected: ['deny', 'deny'],
    });
  });

  test('reads --auto only as a flag of its own', () => {
    assert({
      given:
        '--auto as the value of --body, a repo flag before merge, --auto=false, and a merge URL with a query string',
      should: 'deny each direct merge and allow a real auto-merge request',
      actual: [
        decide('gh pr merge 1 --merge --body --auto'),
        decide('gh pr merge 1 -t --auto --merge'),
        decide('gh pr --repo o/r merge 1 --merge'),
        decide('gh pr merge 1 --auto=false --merge'),
        decide('gh api -X PUT "repos/o/r/pulls/1/merge?merge_method=merge"'),
        decide('gh pr -R o/r merge 1 --auto --merge'),
      ],
      expected: ['deny', 'deny', 'deny', 'deny', 'deny', 'allow'],
    });
  });

  test('refuses API writes that reach main without a push', () => {
    assert({
      given:
        'contents API writes on main or the default branch, the merges API, ref mutations in GraphQL, and a GraphQL query from a file',
      should: 'deny each one for an agent',
      actual: [
        'gh api -X PUT repos/o/r/contents/a.txt -f message=m -f content=eA== -f branch=main',
        'gh api -X DELETE repos/o/r/contents/a.txt -f message=m -f sha=1',
        'gh api repos/o/r/merges -f base=main -f head=pu/x',
        `gh api graphql -f query='mutation { updateRef(input: {refId: "x", oid: "y"}) { clientMutationId } }'`,
        `gh api graphql -f query='mutation { createCommitOnBranch(input: {}) { commit { oid } } }'`,
        'gh api graphql -F query=@mutation.graphql',
      ].map((command) => decide(command)),
      expected: Array(6).fill('deny'),
    });
  });

  test('still allows contents writes to another branch and plain reads', () => {
    assert({
      given: 'a contents write on a feature branch and a GraphQL read',
      should: 'allow both',
      actual: [
        decide(
          'gh api -X PUT repos/o/r/contents/a.txt -f message=m -f content=eA== -f branch=pu/x',
        ),
        decide(`gh api graphql -f query='{ viewer { login } }'`),
      ],
      expected: ['allow', 'allow'],
    });
  });

  test('asks the owner before a direct or admin merge', () => {
    assert({
      given: 'an owner session merging directly, with --admin, and via --auto',
      should: 'ask for direct and admin merges and allow the request',
      actual: [
        decide('gh pr merge 12 --merge', owner()),
        decide('gh pr merge 12 --admin', owner()),
        decide('gh api -X PUT repos/o/r/pulls/12/merge', owner()),
        decide('gh pr merge 12 --auto --merge', owner()),
      ],
      expected: ['ask', 'ask', 'ask', 'allow'],
    });
  });
});

describe('agent guard: rulesets and branch protection', () => {
  test('refuses autonomous mutations of rules and repository settings', () => {
    assert({
      given: 'ruleset, branch protection and settings mutations',
      should: 'deny each one',
      actual: [
        'gh api -X POST repos/o/r/rulesets --input rules.json',
        'gh api --method DELETE repos/o/r/rulesets/7',
        'gh api -X PUT repos/o/r/branches/main/protection',
        'gh api repos/o/r/branches/main/protection/required_status_checks -X PATCH',
        'gh api repos/o/r/rulesets -f name=x',
        'gh api -X PATCH repos/o/r -F allow_auto_merge=false',
        'gh repo edit --enable-auto-merge=false',
        `gh api graphql -f query='mutation { deleteBranchProtectionRule(input: {}) { clientMutationId } }'`,
        'bun github:rules --apply',
      ].map((command) => decide(command)),
      expected: Array(9).fill('deny'),
    });
  });

  test('allows reading rules and lets the owner change them', () => {
    assert({
      given: 'read-only ruleset calls, the dry run, and an owner mutation',
      should: 'allow them',
      actual: [
        decide('gh api repos/o/r/rulesets'),
        decide('gh api repos/o/r/branches/main/protection'),
        decide('bun github:rules'),
        decide('gh api -X POST repos/o/r/rulesets', owner()),
      ],
      expected: ['allow', 'allow', 'allow', 'allow'],
    });
  });
});

describe('agent guard: pre-push refs', () => {
  const zero = '0'.repeat(40);
  const sha = 'a'.repeat(40);

  test('refuses an autonomous push or deletion of main from the hook', () => {
    assert({
      given: 'pre-push lines updating and deleting main',
      should: 'deny both',
      actual: [
        classifyPush([`refs/heads/x ${sha} refs/heads/main ${zero}`], facts())
          .decision,
        classifyPush([`(delete) ${zero} refs/heads/main ${sha}`], facts())
          .decision,
      ],
      expected: ['deny', 'deny'],
    });
  });

  test('allows branch pushes and asks the owner about main', () => {
    assert({
      given: 'an agent branch push and an owner push to main',
      should: 'allow the branch and ask the owner',
      actual: [
        classifyPush(
          [`refs/heads/pu/mine ${sha} refs/heads/pu/mine ${zero}`],
          facts(),
        ).decision,
        classifyPush(
          [`refs/heads/main ${sha} refs/heads/main ${zero}`],
          owner(),
        ).decision,
      ],
      expected: ['allow', 'ask'],
    });
  });
});

describe('agent guard: the owner prompt in pre-push', () => {
  test('pushes only on yes, and passes through only when no terminal exists', () => {
    assert({
      given: 'yes, a bare Enter, Ctrl-D (end of input), and no terminal at all',
      should:
        'push on yes, cancel on Enter and Ctrl-D, allow without a terminal',
      actual: [
        terminalAnswer(0, 'y'),
        terminalAnswer(0, ''),
        terminalAnswer(4, ''),
        terminalAnswer(3, ''),
      ],
      expected: ['push', 'cancel', 'cancel', 'no-terminal'],
    });
  });
});

describe('agent guard: Claude Code hook output', () => {
  test('stays silent on allow so normal permissions apply', () => {
    assert({
      given: 'an allow verdict',
      should: 'emit nothing',
      actual: hookResponse({ decision: 'allow' }),
      expected: undefined,
    });
  });

  test('emits the PreToolUse decision contract for deny and ask', () => {
    assert({
      given: 'a deny verdict',
      should: 'emit hookSpecificOutput with the decision and reason',
      actual: hookResponse({ decision: 'deny', reason: 'no' }),
      expected: {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'no',
        },
      },
    });
  });
});

describe('agent guard: wiring', () => {
  const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
  const env = (autonomous: boolean) => {
    // The owner has neither variable: a PU_AGENT_ID alone makes an agent.
    const base = { ...process.env };
    delete base.DAISY_AUTONOMOUS;
    delete base.PU_AGENT_ID;
    return autonomous ? { ...base, DAISY_AUTONOMOUS: '1' } : base;
  };
  const runHook = (autonomous: boolean, command: string) =>
    Bun.spawnSync(['bun', 'scripts/agent-guard.ts', 'hook'], {
      cwd: root,
      env: { ...env(autonomous), CLAUDE_PROJECT_DIR: root },
      stdin: Buffer.from(
        JSON.stringify({
          cwd: root,
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command },
        }),
      ),
    });
  const decisionOf = (output: string) =>
    output.trim() === ''
      ? 'silent'
      : (
          JSON.parse(output) as {
            hookSpecificOutput: { permissionDecision: string };
          }
        ).hookSpecificOutput.permissionDecision;

  test('registers the guard as the committed PreToolUse hook', async () => {
    const settings = (await Bun.file(
      `${root}/.claude/settings.json`,
    ).json()) as {
      hooks: {
        PreToolUse: { matcher: string; hooks: { command: string }[] }[];
      };
    };
    const [entry] = settings.hooks.PreToolUse;
    assert({
      given: 'the committed Claude Code project settings',
      should: 'run the guard hook on Bash and file-editing tools',
      actual: [
        entry.matcher.split('|').includes('Bash'),
        entry.matcher.split('|').includes('Edit'),
        entry.hooks[0].command.includes('scripts/agent-guard.ts" hook'),
      ],
      expected: [true, true, true],
    });
  });

  test('answers the real hook contract for agents and the owner', () => {
    assert({
      given: 'the hook process fed PreToolUse input',
      should:
        'deny an agent push to main, ask the owner, and stay silent otherwise',
      actual: [
        decisionOf(runHook(true, 'git push origin main').stdout.toString()),
        decisionOf(runHook(false, 'gh pr merge 1 --merge').stdout.toString()),
        decisionOf(runHook(true, 'git status').stdout.toString()),
      ],
      expected: ['deny', 'ask', 'silent'],
    });
  });

  test('blocks agents when the guard itself cannot run', async () => {
    const settings = (await Bun.file(
      `${root}/.claude/settings.json`,
    ).json()) as {
      hooks: { PreToolUse: { hooks: { command: string }[] }[] };
    };
    const command = settings.hooks.PreToolUse[0].hooks[0].command;
    // A project dir without the guard script makes bun fail to start it.
    const run = (autonomous: boolean) =>
      Bun.spawnSync(['sh', '-c', command], {
        env: { ...env(autonomous), CLAUDE_PROJECT_DIR: '/nonexistent' },
        stdin: Buffer.from('{}'),
        stderr: 'pipe',
      }).exitCode;
    assert({
      given: 'the committed hook command with a guard that fails to run',
      should: 'exit 2 (blocking) for an agent and 0 for the owner',
      actual: [run(true), run(false)],
      expected: [2, 0],
    });
  });

  test('refuses an autonomous push to main from the committed pre-push hook', () => {
    const push = Bun.spawnSync(
      ['sh', '.githooks/pre-push', 'origin', 'https://github.com/o/r.git'],
      {
        cwd: root,
        env: env(true),
        stdin: Buffer.from(
          `refs/heads/x ${'a'.repeat(40)} refs/heads/main ${'0'.repeat(40)}\n`,
        ),
        stderr: 'pipe',
      },
    );
    assert({
      given: 'git handing the hook a ref that updates main',
      should: 'exit non-zero with the guard refusal',
      actual: [push.exitCode, push.stderr.toString().includes('refused')],
      expected: [1, true],
    });
  });
});
