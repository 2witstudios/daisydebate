import { assert, setupRitewayBun, test } from 'riteway/bun';
import { gateRequest } from './gate';

setupRitewayBun();
const request = {
  host: 'localhost:4800',
  method: 'GET',
  origin: undefined,
  socketAddress: '::1',
};

test('gateRequest', () => {
  assert({
    given: 'the canonical host',
    should: 'admit with the socket peer',
    actual: gateRequest(request),
    expected: { admit: true, peer: '::1' },
  });
  assert({
    given: 'a loopback literal, a rebinding name or no host',
    should: 'answer 421 before anything runs',
    actual: ['127.0.0.1:4800', '[::1]:4800', 'attacker.example', undefined].map(
      (host) => gateRequest({ ...request, host }),
    ),
    expected: [
      { admit: false, status: 421 },
      { admit: false, status: 421 },
      { admit: false, status: 421 },
      { admit: false, status: 421 },
    ],
  });
  assert({
    given: 'a POST from the canonical origin',
    should: 'admit it',
    actual: gateRequest({
      ...request,
      method: 'POST',
      origin: 'http://localhost:4800',
    }),
    expected: { admit: true, peer: '::1' },
  });
  assert({
    given: 'a POST from a foreign origin, a null origin or none',
    should: 'answer 421 before any server action runs',
    actual: ['http://attacker.example', 'null', undefined].map((origin) =>
      gateRequest({ ...request, method: 'POST', origin }),
    ),
    expected: [
      { admit: false, status: 421 },
      { admit: false, status: 421 },
      { admit: false, status: 421 },
    ],
  });
  assert({
    given: 'a HEAD request without an origin',
    should: 'admit it like a GET',
    actual: gateRequest({ ...request, method: 'HEAD' }),
    expected: { admit: true, peer: '::1' },
  });
});
