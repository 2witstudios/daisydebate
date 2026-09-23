import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createDoctorReport,
  formatDoctorReport,
  isMigrationCurrent,
  readCommittedMigrationHashes,
} from './doctor';

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
        'Daisy doctor: PASS\nPASS bun-version: 1.4.2\nPASS env: valid\nPASS postgres: reachable\nPASS migration-currency: 1 migration\nPASS redis: PONG\nPASS boundaries: verified\n',
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
