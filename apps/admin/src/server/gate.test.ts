import { assert, setupRitewayBun, test } from 'riteway/bun';
import { gateRequest } from './gate';

setupRitewayBun();
test('gateRequest', () => {
  assert({
    given: 'the canonical host',
    should: 'admit with the socket peer',
    actual: gateRequest({ host: 'localhost:4800', socketAddress: '::1' }),
    expected: { admit: true, peer: '::1' },
  });
  assert({
    given: 'a loopback literal, a rebinding name or no host',
    should: 'answer 421 before anything runs',
    actual: ['127.0.0.1:4800', '[::1]:4800', 'attacker.example', undefined].map(
      (host) => gateRequest({ host, socketAddress: '::1' }),
    ),
    expected: [
      { admit: false, status: 421 },
      { admit: false, status: 421 },
      { admit: false, status: 421 },
      { admit: false, status: 421 },
    ],
  });
});
