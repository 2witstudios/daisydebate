import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parsePort } from './port';

setupRitewayBun();

describe('parsePort', () => {
  test('defaults when unset', () => {
    assert({
      given: 'no REALTIME_PORT',
      should: 'fall back to the default',
      actual: parsePort(undefined, 3001),
      expected: 3001,
    });
  });

  test('parses a valid integer', () => {
    assert({
      given: 'REALTIME_PORT=4001',
      should: 'return 4001',
      actual: parsePort('4001', 3001),
      expected: 4001,
    });
  });

  test('rejects an out-of-range or non-integer value', () => {
    expect(() => parsePort('0', 3001)).toThrow('Invalid REALTIME_PORT');
    expect(() => parsePort('70000', 3001)).toThrow('Invalid REALTIME_PORT');
    expect(() => parsePort('abc', 3001)).toThrow('Invalid REALTIME_PORT');
  });
});
