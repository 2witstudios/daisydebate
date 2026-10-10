import { assert, setupRitewayBun, test } from 'riteway/bun';
import { redactText } from './e2e-artifact-sanitizer';
setupRitewayBun();
for (const depth of [0, 1, 2])
  test(`realtime bearer tickets are redacted at JSON depth ${depth}`, () => {
    const serialize = (value: string) =>
      Array.from({ length: depth }).reduce<string>(
        (text) => JSON.stringify(text),
        value,
      );
    const payload = (ticket: string) =>
      JSON.stringify({
        type: 'hello',
        ticket,
        socketUrl: 'wss://localhost:13014/ws',
      });
    assert({
      given:
        'an issuance or hello ticket in plain or nested serialized trace JSON',
      should:
        'redact only the credential and preserve valid surrounding diagnostic data',
      actual: redactText(serialize(payload('a'.repeat(43)))),
      expected: serialize(payload('[REDACTED]')),
    });
  });

for (const depth of [0, 1, 2])
  for (const header of ['set-cookie', 'cookie', 'authorization'])
    test(`trace header ${header} preserves JSON framing at depth ${depth}`, () => {
      const serialize = (message: string) => {
        let text = JSON.stringify({ type: 'log', message, after: 'retained' });
        for (let index = 0; index < depth; index++) text = JSON.stringify(text);
        return text;
      };
      assert({
        given: 'a serialized trace log containing a credential-bearing header',
        should:
          'redact its value without consuming its closing quote or following record fields',
        actual: redactText(
          serialize(`${header}: fixture-\"secret\"\\value\nnext diagnostic`),
        ),
        expected: serialize(`${header}: [REDACTED]\nnext diagnostic`),
      });
    });
