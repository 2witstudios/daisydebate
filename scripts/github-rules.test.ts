import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  applyRefusal,
  diffValues,
  ghFailure,
  planRules,
  type RepositoryConfig,
} from './github-rules';

setupRitewayBun();

const root = new URL('..', import.meta.url).pathname;
const config = (await Bun.file(
  `${root}policy/github/repository.json`,
).json()) as RepositoryConfig;

const ruleTypes = (ruleset: { rules: { type: string }[] }) =>
  ruleset.rules.map((rule) => rule.type);

describe('the committed main ruleset', () => {
  const { ruleset } = config;

  test('requires pull requests and forbids force-push and deletion', () => {
    assert({
      given: 'policy/github/repository.json',
      should: 'target the default branch with the four protective rules',
      actual: [
        ruleset.enforcement,
        ruleset.conditions.ref_name.include,
        ruleTypes(ruleset),
      ],
      expected: [
        'active',
        ['~DEFAULT_BRANCH'],
        [
          'deletion',
          'non_fast_forward',
          'pull_request',
          'required_status_checks',
        ],
      ],
    });
  });

  test('requires the CI and browser gates from GitHub Actions alone', () => {
    const checks = ruleset.rules.find(
      (rule) => rule.type === 'required_status_checks',
    )?.parameters?.required_status_checks;
    assert({
      given: 'the committed required checks',
      should:
        'pin each to GitHub Actions and require no review status (ADR 0083)',
      actual: checks,
      expected: [
        { context: 'CI gate', integration_id: 15368 },
        { context: 'Playwright E2E', integration_id: 15368 },
        { context: 'Isolated Room Launch E2E', integration_id: 15368 },
      ],
    });
  });

  test('lists only the owner as bypass actor, enables auto-merge and branch deletion, and allows merge commits only', () => {
    assert({
      given: 'the committed settings',
      should:
        'let the repository admin role bypass only through pull requests (no direct push to main, the owner included), turn both settings on, and pin merge commits as the only merge method',
      actual: [ruleset.bypass_actors, config.settings],
      expected: [
        [
          {
            actor_id: 5,
            actor_type: 'RepositoryRole',
            bypass_mode: 'pull_request',
          },
        ],
        {
          allow_auto_merge: true,
          delete_branch_on_merge: true,
          allow_merge_commit: true,
          allow_squash_merge: false,
          allow_rebase_merge: false,
        },
      ],
    });
  });
});

describe('diffValues', () => {
  test('lists changed, added and removed leaves by path', () => {
    assert({
      given: 'live and desired values',
      should: 'describe each difference',
      actual: diffValues(
        { a: 1, b: { c: [1, 2] }, d: 'x' },
        { a: 2, b: { c: [1] }, e: true },
      ),
      expected: ['~ a: 1 → 2', '- b.c[1]: 2', '- d: "x"', '+ e: true'],
    });
  });
});

describe('planRules', () => {
  // Live today: every merge method on, auto-merge and branch deletion off.
  const liveSettings = {
    allow_auto_merge: false,
    delete_branch_on_merge: false,
    allow_merge_commit: true,
    allow_squash_merge: true,
    allow_rebase_merge: true,
  };

  test('plans creating the ruleset and fixing settings on a bare repository', () => {
    const plan = planRules({
      config,
      live: { ruleset: undefined, settings: liveSettings },
    });
    assert({
      given: 'no ruleset, both settings off and squash and rebase allowed',
      should: 'plan a create and a settings patch, with the diff',
      actual: [
        plan.actions,
        plan.changes.filter((line) => line.startsWith('~ settings')),
      ],
      expected: [
        ['create ruleset main', 'patch settings'],
        [
          '~ settings.allow_auto_merge: false → true',
          '~ settings.delete_branch_on_merge: false → true',
          '~ settings.allow_squash_merge: true → false',
          '~ settings.allow_rebase_merge: true → false',
        ],
      ],
    });
  });

  test('plans nothing when live GitHub matches', () => {
    const plan = planRules({
      config,
      live: {
        ruleset: { id: 9, ...config.ruleset },
        settings: config.settings,
      },
    });
    assert({
      given: 'a live ruleset and settings equal to the committed ones',
      should: 'report no changes',
      actual: [plan.actions, plan.changes],
      expected: [[], []],
    });
  });
});

describe('ghFailure', () => {
  test("includes gh's own stderr reason, or omits it when gh gave none", () => {
    assert({
      given: 'a failed gh call with a reason on stderr, and one with none',
      should: 'name the command and, when present, the reason',
      actual: [
        ghFailure(
          ['api', '-X', 'PATCH', 'repos/2witstudios/daisydebate'],
          'HTTP 403: Resource not accessible by integration\n',
        ),
        ghFailure(['api', 'repos/2witstudios/daisydebate/rulesets'], ''),
      ],
      expected: [
        'gh api -X PATCH repos/2witstudios/daisydebate failed: HTTP 403: Resource not accessible by integration',
        'gh api repos/2witstudios/daisydebate/rulesets failed',
      ],
    });
  });
});

describe('applyRefusal', () => {
  const ok = { autonomous: false, login: '2witstudios', owner: '2witstudios' };

  test('lets only the owner apply', () => {
    assert({
      given: 'the owner, an agent and another login',
      should: 'allow the owner and refuse the rest',
      actual: [
        applyRefusal(ok),
        applyRefusal({ ...ok, autonomous: true }),
        applyRefusal({ ...ok, login: 'daisy-agent' }),
      ].map((refusal) => refusal === undefined),
      expected: [true, false, false],
    });
  });
});
