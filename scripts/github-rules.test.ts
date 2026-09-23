import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  applyRefusal,
  desiredRuleset,
  diffValues,
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
  const ruleset = desiredRuleset(config, 424242);

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

  test('requires the CI gate from Actions and review-record from the review App', () => {
    const checks = ruleset.rules.find(
      (rule) => rule.type === 'required_status_checks',
    )?.parameters?.required_status_checks;
    assert({
      given: 'the review App id read from the repository',
      should: 'pin each required check to its only legitimate source',
      actual: checks,
      expected: [
        { context: 'CI gate', integration_id: 15368 },
        { context: 'review-record', integration_id: 424242 },
      ],
    });
  });

  test('lists only the owner as bypass actor and enables auto-merge and branch deletion', () => {
    assert({
      given: 'the committed settings',
      should:
        'bypass only for the repository admin role and turn both settings on',
      actual: [ruleset.bypass_actors, config.settings],
      expected: [
        [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
        { allow_auto_merge: true, delete_branch_on_merge: true },
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
  const liveSettings = {
    allow_auto_merge: false,
    delete_branch_on_merge: false,
  };

  test('plans creating the ruleset and fixing settings on a bare repository', () => {
    const plan = planRules({
      config,
      appId: 424242,
      live: { ruleset: undefined, settings: liveSettings },
    });
    assert({
      given: 'no ruleset and both settings off',
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
        ],
      ],
    });
  });

  test('plans nothing when live GitHub matches', () => {
    const plan = planRules({
      config,
      appId: 424242,
      live: {
        ruleset: { id: 9, ...desiredRuleset(config, 424242) },
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

describe('applyRefusal', () => {
  const ok = {
    autonomous: false,
    login: '2witstudios',
    owner: '2witstudios',
    appId: 1,
  };

  test('lets only the owner apply, and only with the review App known', () => {
    assert({
      given: 'the owner, an agent, another login, and a missing App id',
      should: 'allow the owner and refuse the rest',
      actual: [
        applyRefusal(ok),
        applyRefusal({ ...ok, autonomous: true }),
        applyRefusal({ ...ok, login: 'daisy-agent' }),
        applyRefusal({ ...ok, appId: undefined }),
      ].map((refusal) => refusal === undefined),
      expected: [true, false, false, false],
    });
  });
});
