import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requestId, withSpan, withTimeout } from './index';

setupRitewayBun();

describe('correlation', () => {
  test('accepts constrained identifiers only', () => {
    assert({
      given: 'a well-formed request id',
      should: 'pass it through unchanged',
      actual: requestId('request-123'),
      expected: 'request-123',
    });
    assert({
      given: 'a request id containing a newline',
      should: 'strip the control character',
      actual: requestId('bad\nheader').includes('\n'),
      expected: false,
    });
  });
});

describe('tracing', () => {
  test('preserves results and errors without a provider', async () => {
    assert({
      given: 'a span around a successful operation',
      should: 'return the operation result',
      actual: await withSpan('test', {}, async () => 42),
      expected: 42,
    });
    await expect(
      withSpan('test', {}, async () => {
        throw new Error('failure');
      }),
    ).rejects.toThrow('failure');
  });
});

describe('withTimeout', () => {
  test('bounds the wait', async () => {
    await expect(withTimeout(new Promise(() => {}), 5)).rejects.toThrow(
      'timed out',
    );
  });
});
