import { assert, setupRitewayBun, test } from 'riteway/bun';
import { hostAllowed, sameOrigin } from './origin';

setupRitewayBun();
test('hostAllowed', () => {
  assert({
    given: 'the canonical host',
    should: 'allow it',
    actual: hostAllowed('localhost:4800'),
    expected: true,
  });
  assert({
    given: 'loopback literals, another port, a rebinding name or no host',
    should: 'refuse every one',
    actual: [
      '127.0.0.1:4800',
      '[::1]:4800',
      'localhost:8080',
      'localhost',
      'evil.example:4800',
      'LOCALHOST:4800',
      undefined,
      null,
    ].map(hostAllowed),
    expected: [false, false, false, false, false, false, false, false],
  });
});

test('sameOrigin', () => {
  assert({
    given: 'the canonical origin and its near misses',
    should: 'allow only the exact origin',
    actual: [
      'http://localhost:4800',
      'https://localhost:4800',
      'http://localhost:4800/',
      'http://127.0.0.1:4800',
      'null',
      null,
    ].map(sameOrigin),
    expected: [true, false, false, false, false, false],
  });
});
