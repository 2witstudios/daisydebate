import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { requireSameOriginForm } from './http';

setupRitewayBun();

const at = (headers: Record<string, string>) => () =>
  requireSameOriginForm(
    new Request('http://localhost/auth/confirm', { headers }),
    'http://localhost:3000',
  );
const admitted = (headers: Record<string, string>) => {
  at(headers)();
  return true;
};

describe('requireSameOriginForm', () => {
  test('accepts the origin a no-referrer page sends only from the same origin', () => {
    assert({
      given:
        'Origin null with Sec-Fetch-Site same-origin, and the plain origin',
      should: 'admit both',
      actual: [
        admitted({ origin: 'null', 'sec-fetch-site': 'same-origin' }),
        admitted({ origin: 'http://localhost:3000' }),
      ],
      expected: [true, true],
    });
  });

  test('refuses an opaque origin that is not provably same-origin', () => {
    for (const headers of [
      { origin: 'null' },
      { origin: 'null', 'sec-fetch-site': 'cross-site' },
      { origin: 'null', 'sec-fetch-site': 'same-site' },
      { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' },
      {},
    ])
      expect(at(headers)).toThrow(createAppError('AUTHORIZATION'));
  });
});
