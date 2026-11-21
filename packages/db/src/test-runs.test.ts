import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  slotDatabaseOfRun,
  testRunDatabaseName,
  testRunToken,
} from './test-runs';
setupRitewayBun();

describe('test run database names', () => {
  test('a token is eight hex digits of the bytes it is given', () => {
    assert({
      given: 'four bytes from the runner CSPRNG',
      should: 'name them as eight lowercase hex digits',
      actual: testRunToken(new Uint8Array([0x0a, 0x1b, 0xff, 0x00])),
      expected: '0a1bff00',
    });
    expect(() => testRunToken(new Uint8Array([1, 2, 3]))).toThrow('four bytes');
  });

  test('a run database extends the slot test database and maps back to it', () => {
    const name = testRunDatabaseName('daisy_wt_abc_test', '0a1b2c3d');

    assert({
      given: 'a slot test database and a token',
      should: 'append _run_<token>, and map back to the slot database',
      actual: [name, slotDatabaseOfRun(name)],
      expected: ['daisy_wt_abc_test_run_0a1b2c3d', 'daisy_wt_abc_test'],
    });
  });

  test('refuses anything that is not a slot test database or a token', () => {
    assert({
      given: 'a dev database, a run database as the base, and a bad token',
      should: 'refuse each and map non-run names to nothing',
      actual: [
        (() => {
          try {
            return testRunDatabaseName('daisy_wt_abc', '0a1b2c3d');
          } catch (error) {
            return String(error);
          }
        })(),
        (() => {
          try {
            return testRunDatabaseName('daisy_test', 'XYZ');
          } catch (error) {
            return String(error);
          }
        })(),
        slotDatabaseOfRun('daisy_wt_abc_test'),
        slotDatabaseOfRun('daisy_test_run_0a1b2c3'),
      ],
      expected: [
        'Error: A run database extends a slot _test database, got "daisy_wt_abc"',
        'Error: A run token is eight lowercase hex digits',
        undefined,
        undefined,
      ],
    });
  });
});
