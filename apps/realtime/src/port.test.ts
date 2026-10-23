import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { DEFAULT_REALTIME_PORT, parseHostname, parsePort } from './port';

setupRitewayBun();

describe('DEFAULT_REALTIME_PORT', () => {
  test('is distinct from the web PORT example in .env.example', () => {
    assert({
      given: 'the realtime default port',
      should: 'differ from the web PORT default of 3001',
      actual: DEFAULT_REALTIME_PORT,
      expected: 3011,
    });
  });
});

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

describe('parseHostname', () => {
  test('listens on every interface when unset', () => {
    assert({
      given: 'no REALTIME_HOST',
      should: 'return the production all-interfaces address',
      actual: parseHostname(undefined),
      expected: '0.0.0.0',
    });
  });

  test('accepts a loopback literal', () => {
    assert({
      given: 'REALTIME_HOST=127.0.0.1',
      should: 'return it unchanged',
      actual: parseHostname('127.0.0.1'),
      expected: '127.0.0.1',
    });
  });

  test('rejects a name that is not an IP literal', () => {
    expect(() => parseHostname('localhost')).toThrow('Invalid REALTIME_HOST');
  });
});
