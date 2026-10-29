import { assert, setupRitewayBun, test } from 'riteway/bun';
import { hostAllowed, sameOrigin, readAdminOrigin } from './origin';

setupRitewayBun();
test('hostAllowed', () => {
  assert({
    given: 'the canonical host',
    should: 'allow it',
    actual: hostAllowed('localhost:4800', 'http://localhost:4800'),
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
    ].map((host) => hostAllowed(host, 'http://localhost:4800')),
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
    ].map((origin) => sameOrigin(origin, 'http://localhost:4800')),
    expected: [true, false, false, false, false, false],
  });
});

test('readAdminOrigin', () => {
  const accepted = 'https://daisy-admin.tail51baf2.ts.net';
  assert({
    given: 'the configured HTTPS origin',
    should: 'keep its exact serialization',
    actual: readAdminOrigin(accepted, 'production'),
    expected: accepted,
  });
  const invalid = [
    undefined,
    '',
    'http://localhost:4800',
    'http://evil.example',
    accepted + '/',
    accepted + '/path',
    accepted + '?x=1',
    accepted + '#x',
    'https://user:pass@host',
    'https://HOST',
    'https://host:443',
    'https://127.0.0.1',
    'https://host\\evil',
  ];
  assert({
    given: 'missing, insecure or noncanonical production origins',
    should: 'refuse without echoing the value',
    actual: invalid.map((origin) => {
      try {
        readAdminOrigin(origin, 'production');
        return false;
      } catch (error) {
        return (
          (error as Error).message ===
          'Invalid admin configuration: ADMIN_ORIGIN'
        );
      }
    }),
    expected: invalid.map(() => true),
  });
  assert({
    given: 'local development',
    should: 'use the sole HTTP loopback origin',
    actual: readAdminOrigin(undefined, 'development'),
    expected: 'http://localhost:4800',
  });
});
