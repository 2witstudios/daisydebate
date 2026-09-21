import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { readJson } from './http';

setupRitewayBun();

const jsonRequest = (body: string, contentType = 'application/json') =>
  new Request('http://localhost/api/foundation/proof', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });

describe('readJson', () => {
  test('parses bounded JSON bodies', async () => {
    assert({
      given: 'a JSON request body',
      should: 'parse it into an object',
      actual: await readJson(jsonRequest('{"a":1}')),
      expected: { a: 1 },
    });
  });

  test('rejects non-JSON content types', () => {
    expect(() =>
      readJson(jsonRequest('a=1', 'application/x-www-form-urlencoded')),
    ).toThrow(createAppError('VALIDATION'));
  });

  test('rejects bodies beyond the byte bound', async () => {
    const large = JSON.stringify({ text: 'x'.repeat(128) });
    await expect(readJson(jsonRequest(large), 64)).rejects.toThrow(
      createAppError('PAYLOAD_TOO_LARGE'),
    );
  });

  test('rejects malformed JSON', async () => {
    await expect(readJson(jsonRequest('{nope'))).rejects.toThrow(
      createAppError('VALIDATION'),
    );
  });
});
