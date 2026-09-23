import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  readStagingEvidence,
  stagingDecision,
  type StagingEvidence,
} from './staging-gate';

setupRitewayBun();

const green: StagingEvidence = {
  trigger: 'Browser E2E',
  ci: {
    status: 'completed',
    gate: 'success',
    completedAt: '2026-09-23T17:58:00Z',
  },
  e2e: {
    status: 'completed',
    conclusion: 'success',
    completedAt: '2026-09-23T18:02:00Z',
  },
};

describe('stagingDecision', () => {
  test('a green CI gate and green E2E, the audit aside', () => {
    assert({
      given: 'a green CI gate and a green E2E run, triggered by the later run',
      should: 'deploy',
      actual: stagingDecision(green).deploy,
      expected: true,
    });
  });

  test('a red CI gate', () => {
    assert({
      given: 'a CI gate that failed',
      should: 'not deploy',
      actual: stagingDecision({
        ...green,
        ci: { ...green.ci, gate: 'failure' },
      }).deploy,
      expected: false,
    });
  });

  test('a CI run without a gate verdict', () => {
    assert({
      given: 'a CI run whose gate job never ran',
      should: 'not deploy',
      actual: stagingDecision({ ...green, ci: { ...green.ci, gate: null } })
        .deploy,
      expected: false,
    });
  });

  test('a red E2E run', () => {
    assert({
      given: 'a green CI gate but a failed E2E run',
      should: 'not deploy',
      actual: stagingDecision({
        ...green,
        e2e: { ...green.e2e, conclusion: 'failure' },
      }).deploy,
      expected: false,
    });
  });

  test('E2E still running', () => {
    assert({
      given: 'CI finished green while E2E is still in progress',
      should: 'wait for the E2E completion to decide',
      actual: stagingDecision({
        ...green,
        trigger: 'CI',
        e2e: { status: 'in_progress', conclusion: null, completedAt: null },
      }),
      expected: {
        deploy: false,
        reason: 'Browser E2E has not completed; its completion decides',
      },
    });
  });

  test('CI still running', () => {
    assert({
      given: 'E2E finished green while CI is still in progress',
      should: 'wait for the CI completion to decide',
      actual: stagingDecision({
        ...green,
        ci: { status: 'in_progress', gate: null, completedAt: null },
      }).deploy,
      expected: false,
    });
  });

  test('missing runs', () => {
    assert({
      given: 'no E2E run for the commit',
      should: 'not deploy',
      actual: stagingDecision({ ...green, e2e: undefined }).deploy,
      expected: false,
    });
  });

  test('both runs complete, the earlier one triggering', () => {
    assert({
      given:
        'both runs green, triggered by the run that completed first (CI here)',
      should: 'leave the deploy to the later completion so it ships once',
      actual: stagingDecision({ ...green, trigger: 'CI' }).deploy,
      expected: false,
    });
  });

  test('both runs complete at the same instant', () => {
    const at = '2026-09-23T18:00:00Z';
    const tie = {
      ...green,
      ci: { ...green.ci, completedAt: at },
      e2e: { ...green.e2e, completedAt: at },
    };
    assert({
      given: 'both runs green and completed at the same second',
      should: 'deploy from exactly one trigger, the CI one',
      actual: [
        stagingDecision({ ...tie, trigger: 'CI' }).deploy,
        stagingDecision({ ...tie, trigger: 'Browser E2E' }).deploy,
      ],
      expected: [true, false],
    });
  });
});

describe('readStagingEvidence', () => {
  const sha = 'f5e5b89c8f6ab18fde56c07c0e4c5fea9fa7ae8c';
  const runs = {
    workflow_runs: [
      {
        id: 2,
        path: '.github/workflows/ci.yml',
        status: 'completed',
        conclusion: 'failure',
        updated_at: '2026-09-23T17:58:00Z',
        head_branch: 'main',
      },
      {
        id: 1,
        path: '.github/workflows/ci.yml',
        status: 'completed',
        conclusion: 'cancelled',
        updated_at: '2026-09-23T17:50:00Z',
        head_branch: 'main',
      },
      {
        id: 3,
        path: '.github/workflows/e2e.yml',
        status: 'completed',
        conclusion: 'success',
        updated_at: '2026-09-23T18:02:00Z',
        head_branch: 'main',
      },
    ],
  };
  const jobs = {
    jobs: [
      { name: 'Dependency vulnerability audit', conclusion: 'failure' },
      { name: 'CI gate', conclusion: 'success' },
    ],
  };

  test('a CI run that failed only on the audit', () => {
    const calls: string[] = [];
    const evidence = readStagingEvidence(
      (path) => {
        calls.push(path);
        return path.includes('/jobs') ? jobs : runs;
      },
      { repository: '2witstudios/daisydebate', sha, trigger: 'Browser E2E' },
    );
    assert({
      given:
        'the newest CI run failed on the audit alone and E2E passed (as at f5e5b89)',
      should: "read the CI gate's verdict rather than the run's conclusion",
      actual: { evidence, deploy: stagingDecision(evidence).deploy },
      expected: {
        evidence: {
          trigger: 'Browser E2E',
          ci: {
            status: 'completed',
            gate: 'success',
            completedAt: '2026-09-23T17:58:00Z',
          },
          e2e: {
            status: 'completed',
            conclusion: 'success',
            completedAt: '2026-09-23T18:02:00Z',
          },
        },
        deploy: true,
      },
    });
    assert({
      given: 'the lookups',
      should: 'list main push runs for the commit, then the newest CI jobs',
      actual: calls,
      expected: [
        `repos/2witstudios/daisydebate/actions/runs?head_sha=${sha}&event=push&branch=main&per_page=100`,
        'repos/2witstudios/daisydebate/actions/runs/2/jobs?filter=latest&per_page=100',
      ],
    });
  });
});
