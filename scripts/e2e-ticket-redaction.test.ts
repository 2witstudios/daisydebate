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
