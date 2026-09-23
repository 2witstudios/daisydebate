import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  checkoutCheck,
  createDoctorReport,
  formatDoctorReport,
  isMigrationCurrent,
  orphanCheck,
  puConfigCheck,
  readCommittedMigrationHashes,
  slotCheck,
  type DoctorCheck,
} from './doctor';
import { slotEnvValues, worktreeSlot } from './slot-model';

setupRitewayBun();

describe('doctor report', () => {
  test('preserves the stable check order and derives overall health', () => {
    const report = createDoctorReport([
      { name: 'redis', status: 'pass', detail: 'PONG' },
      { name: 'bun-version', status: 'pass', detail: '1.4.2' },
      { name: 'env', status: 'fail', detail: 'DATABASE_URL' },
    ]);

    assert({
      given: 'doctor checks in arbitrary order with one failure',
      should: 'return an ordered report marked unhealthy',
      actual: report,
      expected: {
        ok: false,
        checks: [
          { name: 'bun-version', status: 'pass', detail: '1.4.2' },
          { name: 'env', status: 'fail', detail: 'DATABASE_URL' },
          { name: 'postgres', status: 'fail', detail: 'not checked' },
          { name: 'migration-currency', status: 'fail', detail: 'not checked' },
          { name: 'redis', status: 'pass', detail: 'PONG' },
          { name: 'boundaries', status: 'fail', detail: 'not checked' },
          { name: 'slot', status: 'fail', detail: 'not checked' },
          { name: 'slot-orphans', status: 'fail', detail: 'not checked' },
          { name: 'github-identity', status: 'fail', detail: 'not checked' },
          { name: 'identity-regime', status: 'fail', detail: 'not checked' },
          { name: 'pu-config', status: 'fail', detail: 'not checked' },
          { name: 'checkout', status: 'fail', detail: 'not checked' },
        ],
      },
    });
  });

  test('renders machine-readable and human-readable reports without changing data', () => {
    const report = createDoctorReport([
      { name: 'bun-version', status: 'pass', detail: '1.4.2' },
      { name: 'env', status: 'pass', detail: 'valid' },
      { name: 'postgres', status: 'pass', detail: 'reachable' },
      { name: 'migration-currency', status: 'pass', detail: '1 migration' },
      { name: 'redis', status: 'pass', detail: 'PONG' },
      { name: 'boundaries', status: 'pass', detail: 'verified' },
      { name: 'slot', status: 'pass', detail: 'daisy' },
      { name: 'slot-orphans', status: 'warn', detail: 'orphaned slots: gone' },
      {
        name: 'github-identity',
        status: 'pass',
        detail: 'autonomous as daisy-agent (GH_TOKEN, HTTPS push)',
      },
      {
        name: 'identity-regime',
        status: 'pass',
        detail: 'identity regime active (agent)',
      },
      {
        name: 'pu-config',
        status: 'pass',
        detail: 'agents start through scripts/agent-launch.sh',
      },
      { name: 'checkout', status: 'pass', detail: 'worktree on pu/x' },
    ]);

    assert({
      given: 'a healthy doctor report',
      should: 'render stable JSON',
      actual: JSON.parse(formatDoctorReport(report, true)),
      expected: report,
    });
    assert({
      given: 'a healthy doctor report',
      should: 'render a passing text summary',
      actual: formatDoctorReport(report, false),
      expected:
        'Daisy doctor: PASS\nPASS bun-version: 1.4.2\nPASS env: valid\nPASS postgres: reachable\nPASS migration-currency: 1 migration\nPASS redis: PONG\nPASS boundaries: verified\nPASS slot: daisy\nWARN slot-orphans: orphaned slots: gone\nPASS github-identity: autonomous as daisy-agent (GH_TOKEN, HTTPS push)\nPASS identity-regime: identity regime active (agent)\nPASS pu-config: agents start through scripts/agent-launch.sh\nPASS checkout: worktree on pu/x\n',
    });
  });
});

describe('slot checks', () => {
  const slot = worktreeSlot('abc');
  const env = {
    DATABASE_URL: 'postgres://daisy:pw@localhost:15432/daisy',
    TEST_DATABASE_URL: 'postgres://daisy:pw@localhost:15432/daisy_test',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_NAMESPACE: 'daisy',
  };

  test('fails a worktree whose .env names another slot', () => {
    assert({
      given: 'a worktree .env copied from the main checkout',
      should: 'fail naming each mismatch and the fix',
      actual: slotCheck(slot, env),
      expected: {
        name: 'slot',
        status: 'fail',
        detail:
          'slot abc: DATABASE_URL names "daisy", expected "daisy_wt_abc"; TEST_DATABASE_URL names "daisy_test", expected "daisy_wt_abc_test"; E2E_DATABASE_URL is unset, expected "daisy_wt_abc_test"; REDIS_NAMESPACE names "daisy", expected "daisy-wt-abc"; E2E_REDIS_NAMESPACE is unset, expected "daisy-wt-abc-e2e" (run bun slot:up)',
      },
    });
  });

  test('passes a worktree whose .env slot:up wrote', () => {
    assert({
      given: 'the values slot:up writes',
      should: 'pass naming the slot',
      actual: slotCheck(slot, slotEnvValues({ slot, env, portBlock: 1 })),
      expected: { name: 'slot', status: 'pass', detail: 'abc' },
    });
  });

  test('reports orphaned slots without failing the report', () => {
    const warned = orphanCheck(['gone', 'old']);
    assert({
      given: 'orphaned and no orphaned slots',
      should: 'warn with the prune command, and pass when none',
      actual: [
        warned,
        orphanCheck([]),
        createDoctorReport([warned]).checks.find(
          (check) => check.name === 'slot-orphans',
        )?.status,
      ],
      expected: [
        {
          name: 'slot-orphans',
          status: 'warn',
          detail: 'orphaned slots: gone, old (run bun slot:prune)',
        },
        { name: 'slot-orphans', status: 'pass', detail: 'none' },
        'warn',
      ],
    });
    assert({
      given: 'a report whose only non-pass check is a warning',
      should: 'stay healthy',
      actual: createDoctorReport([
        ...(
          [
            'bun-version',
            'env',
            'postgres',
            'migration-currency',
            'redis',
            'boundaries',
            'slot',
            'github-identity',
            'identity-regime',
            'pu-config',
            'checkout',
          ] as const
        ).map((name): DoctorCheck => ({ name, status: 'pass', detail: '' })),
        warned,
      ]).ok,
      expected: true,
    });
  });
});

describe('migration currency', () => {
  test('requires the applied migrations to exactly match the committed journal', () => {
    assert({
      given: 'committed and applied migration tags',
      should: 'accept an exact match and reject drift',
      actual: [
        isMigrationCurrent(['0000_baseline'], ['0000_baseline']),
        isMigrationCurrent(['0000_baseline'], []),
        isMigrationCurrent(
          ['0000_baseline'],
          ['0000_baseline', '0001_unexpected'],
        ),
      ],
      expected: [true, false, false],
    });
  });

  test('reads the hashes of committed migration SQL', async () => {
    assert({
      given: 'the committed migration journal and SQL files',
      should: 'return the migration hashes in journal order',
      actual: await readCommittedMigrationHashes(),
      expected: [
        'dd8e9ee51c1dff111cf2d975378c3cdc6bbfc77b1834a66d6905cc998d7301bb',
        '5d92da2588999e499b2e80cd748e547ea5b669f07bc1aa4d14584bd49b35a7a3',
        '92dea778e7b6329f8f438e81b0df14572e4fb7f3cdf1fc3c5f85bcd40984da0e',
        '5a537451d5b0ef25c5b3446f7be06ed8d9154a58a78293c8fe8efd11f5054e35',
        'a6d26437b57c69304a79427e323fad55b40fdb7c0d4bab13b645450888003a5d',
      ],
    });
  });
});

describe('checkout check', () => {
  test('warns, not fails, when the main checkout is off main', () => {
    assert({
      given: 'the main checkout on a feature branch, and a worktree',
      should: 'warn for the first and pass the second',
      actual: [
        checkoutCheck({ mainCheckout: true, branch: 'docs/x' }).status,
        checkoutCheck({ mainCheckout: false, branch: 'pu/x' }),
      ],
      expected: [
        'warn',
        { name: 'checkout', status: 'pass', detail: 'worktree on pu/x' },
      ],
    });
  });
});

describe('pu config check', () => {
  test('fails when pu has replaced the committed launcher configuration', () => {
    assert({
      given: 'a modified, a deleted and an untouched .pu/config.yaml',
      should: 'fail the first two and pass the last',
      actual: [
        puConfigCheck(' M .pu/config.yaml\n').status,
        puConfigCheck(' D .pu/config.yaml\n').status,
        puConfigCheck(''),
      ],
      expected: [
        'fail',
        'fail',
        {
          name: 'pu-config',
          status: 'pass',
          detail: 'agents start through scripts/agent-launch.sh',
        },
      ],
    });
  });
});
