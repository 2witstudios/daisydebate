import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { requireSameOriginRead } from './http';

setupRitewayBun();

const appOrigin = 'http://localhost:3000';
const read = (headers: Record<string, string>) =>
  new Request(`${appOrigin}/api/foundation/proof?id=x`, { headers });
const allowed = (headers: Record<string, string>) => {
  requireSameOriginRead(read(headers), appOrigin);
  return true;
};

describe('requireSameOriginRead', () => {
  test('allows reads a browser or tool sends from the same origin', () => {
    assert({
      given: 'a same-origin GET, which browsers send without an Origin header',
      should: 'be allowed',
      actual: allowed({}),
      expected: true,
    });
    assert({
      given: 'fetch metadata declaring a same-origin request',
      should: 'be allowed',
      actual: allowed({ 'sec-fetch-site': 'same-origin' }),
      expected: true,
    });
    assert({
      given: 'a user-initiated navigation (Sec-Fetch-Site: none)',
      should: 'be allowed',
      actual: allowed({ 'sec-fetch-site': 'none' }),
      expected: true,
    });
    assert({
      given: 'an Origin header matching the application origin',
      should: 'be allowed',
      actual: allowed({ origin: appOrigin }),
      expected: true,
    });
  });

  test('refuses reads initiated from another site', () => {
    for (const headers of [
      { origin: 'https://evil.example' },
      { origin: 'null' },
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
      { 'sec-fetch-site': 'cross-site', origin: appOrigin },
    ])
      expect(() => requireSameOriginRead(read(headers), appOrigin)).toThrow(
        createAppError('AUTHORIZATION'),
      );
  });
});
