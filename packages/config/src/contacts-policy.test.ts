import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readServerConfig } from './index';
import { env, policyRefusal } from './server-env.test-support';
setupRitewayBun();
const failure = policyRefusal(env, 'CONTACTS_POLICY');

test('CONTACTS_POLICY carries only explicit DEC-251 request overrides', () => {
  const override = { requests: { daily: 10, declineBlockMs: 3_000_000_000 } };
  assert({
    given: 'no override and then a partial one',
    should: 'leave absence inert and keep every explicit number as given',
    actual: [
      readServerConfig(env).CONTACTS_POLICY,
      readServerConfig({ ...env, CONTACTS_POLICY: JSON.stringify(override) })
        .CONTACTS_POLICY,
    ],
    expected: [undefined, override],
  });
});

test('CONTACTS_POLICY refuses anything but positive integers in known fields', () => {
  assert({
    given: 'malformed JSON, an unknown key, a zero and a fraction',
    should: 'refuse each at boot, naming the variable or its field',
    actual: [
      failure('{'),
      failure(JSON.stringify({ send: [] })),
      failure(JSON.stringify({ requests: { daily: 0 } })),
      failure(JSON.stringify({ requests: { unrelatedHourly: 1.5 } })),
    ],
    expected: [
      'CONTACTS_POLICY',
      'CONTACTS_POLICY',
      'CONTACTS_POLICY.requests.daily',
      'CONTACTS_POLICY.requests.unrelatedHourly',
    ].map((field) => `Invalid server configuration: ${field}`),
  });
});
