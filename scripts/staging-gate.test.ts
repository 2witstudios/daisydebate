import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  readStagingEvidence,
  stagingDecision,
  type StagingEvidence,
} from './staging-gate';

setupRitewayBun();

const TIP = 'f5e5b89c8f6ab18fde56c07c0e4c5fea9fa7ae8c';
const OLDER = '87bdb47000000000000000000000000000000000';

const green: StagingEvidence = {
  sha: TIP,
  mainTip: TIP,
  ci: { status: 'completed', gate: 'success' },
};

describe('stagingDecision', () => {
  test('a green CI gate', () => {
    assert({
      given: "a green CI gate on main's tip, with no Browser E2E verdict read",
      should: 'deploy',
      actual: stagingDecision(green),
      expected: { deploy: true, reason: 'the CI gate is green' },
    });
  });

  test('a red CI gate', () => {
    assert({
      given: 'a CI gate that failed',
      should: 'not deploy',
      actual: stagingDecision({
        ...green,
        ci: { status: 'completed', gate: 'failure' },
      }),
      expected: { deploy: false, reason: 'the CI gate ended failure' },
    });
  });

  test('a CI run without a gate verdict', () => {
    assert({
      given: 'a CI run whose gate job never ran',
      should: 'not deploy',
      actual: stagingDecision({
        ...green,
        ci: { status: 'completed', gate: null },
      }).deploy,
      expected: false,
    });
  });

  test('CI still running', () => {
    assert({
      given: 'a CI run still in progress',
      should: 'wait for its completion to decide',
      actual: stagingDecision({
        ...green,
        ci: { status: 'in_progress', gate: null },
      }),
      expected: {
        deploy: false,
        reason: 'CI has not completed; its completion decides',
      },
    });
  });

  test('no CI run', () => {
    assert({
      given: 'no CI run for the commit',
      should: 'not deploy',
      actual: stagingDecision({ sha: TIP, mainTip: TIP }).deploy,
      expected: false,
    });
  });
});

describe('stagingDecision: the main-tip rule', () => {
  test('a re-run on a commit that is no longer main tip', () => {
    assert({
      given: 'a green CI gate for a commit main has moved past',
      should: 'not deploy, so staging never rolls back to older code',
      actual: stagingDecision({ ...green, sha: OLDER }),
      expected: {
        deploy: false,
        reason: `${OLDER} is no longer main's tip (${TIP})`,
      },
    });
  });
});

describe('the deploy-staging trigger', () => {
  test('only CI starts it', async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file('.github/workflows/deploy-staging.yml').text(),
    ) as { on: { workflow_run: { workflows: string[] } } };
    assert({
      given: 'the deploy-staging workflow',
      should: 'start on CI completion, never on Browser E2E',
      actual: workflow.on.workflow_run.workflows,
      expected: ['CI'],
    });
  });
});

describe('readStagingEvidence', () => {
  const sha = TIP;
  const runs = {
    workflow_runs: [
      { id: 2, path: '.github/workflows/ci.yml', status: 'completed' },
      { id: 1, path: '.github/workflows/ci.yml', status: 'completed' },
      { id: 3, path: '.github/workflows/e2e.yml', status: 'in_progress' },
    ],
  };
  const jobs = {
    jobs: [
      { name: 'Dependency vulnerability audit', conclusion: 'failure' },
      { name: 'CI gate', conclusion: 'failure' },
    ],
  };

  test('a CI run that failed on the audit', () => {
    const calls: string[] = [];
    const evidence = readStagingEvidence(
      (path) => {
        calls.push(path);
        if (path.endsWith('/commits/main')) return { sha };
        return path.includes('/jobs') ? jobs : runs;
      },
      { repository: '2witstudios/daisydebate', sha },
    );
    assert({
      given:
        'the newest CI run failed on the audit, which the CI gate needs, and E2E is still running',
      should: "read the CI gate's verdict and hold staging back",
      actual: { evidence, deploy: stagingDecision(evidence).deploy },
      expected: {
        evidence: {
          sha,
          mainTip: sha,
          ci: { status: 'completed', gate: 'failure' },
        },
        deploy: false,
      },
    });
    assert({
      given: 'the lookups',
      should:
        "read main's tip, list main push runs for the commit, then the newest CI jobs",
      actual: calls,
      expected: [
        'repos/2witstudios/daisydebate/commits/main',
        `repos/2witstudios/daisydebate/actions/runs?head_sha=${sha}&event=push&branch=main&per_page=100`,
        'repos/2witstudios/daisydebate/actions/runs/2/jobs?filter=latest&per_page=100',
      ],
    });
  });

  test('a CI run still in progress', () => {
    const evidence = readStagingEvidence(
      (path) =>
        path.endsWith('/commits/main')
          ? { sha }
          : {
              workflow_runs: [
                {
                  id: 5,
                  path: '.github/workflows/ci.yml',
                  status: 'in_progress',
                },
              ],
            },
      { repository: '2witstudios/daisydebate', sha },
    );
    assert({
      given: 'a CI run that has not completed',
      should: 'read no gate verdict',
      actual: evidence.ci,
      expected: { status: 'in_progress', gate: null },
    });
  });
});
