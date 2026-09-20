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
        isMigrationCurrent(['0000_optimal_calypso'], ['0000_optimal_calypso']),
        isMigrationCurrent(['0000_optimal_calypso'], []),
        isMigrationCurrent(
          ['0000_optimal_calypso'],
          ['0000_optimal_calypso', '0001_unexpected'],
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
        '18b8ceed0a16e3f7b68844efc8eadae18b6183cbde61aec8e3c58c9741cb187a',
        '0c65b0d134f7d1ee56c904385d3e7f322eb92d9914fa57a0978d665a0f789af5',
        '26bc771093f48248911ceb3075464d3b3d3fb22705568ab03211aeba16b2be9d',
        '43cb611750d9a24b688fab220969bac701fe5db85ca4e265de2b67cb02616e9b',
      ],
    });
  });
});
