import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readServerConfig } from './index';
setupRitewayBun();
const env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
  REDIS_URL: 'redis://localhost:6379',
  PUBLIC_APP_URL: 'http://localhost:3000',
};
const failure = (value: string) => {
  try {
    readServerConfig({ ...env, MESSAGING_POLICY: value });
    return 'accepted';
  } catch (error) {
    return (error as Error).message.split(':').slice(0, 2).join(':').trim();
  }
};

test('MESSAGING_POLICY carries only explicit DEC-251 overrides', () => {
  const override = {
    editWindowMs: 60_000,
    send: [{ max: 5, windowSeconds: 10 }],
    reactions: { distinctPerMessage: 4 },
  };
  assert({
    given: 'no override and then a partial one',
    should: 'leave absence inert and keep every explicit number as given',
    actual: [
      readServerConfig(env).MESSAGING_POLICY,
      readServerConfig({ ...env, MESSAGING_POLICY: JSON.stringify(override) })
        .MESSAGING_POLICY,
    ],
    expected: [undefined, override],
  });
});

test('MESSAGING_POLICY refuses anything but positive integers in known fields', () => {
  assert({
    given:
      'malformed JSON, an unknown key, the social request budget Contacts owns, a zero, a fraction and two windows of one length',
    should: 'refuse each at boot, naming the variable or its field',
    actual: [
      failure('{'),
      failure(JSON.stringify({ channelSend: [] })),
      failure(JSON.stringify({ socialRequests: { daily: 10 } })),
      failure(JSON.stringify({ editWindowMs: 0 })),
      failure(JSON.stringify({ fileUploadsDaily: 1.5 })),
      failure(
        JSON.stringify({
          send: [
            { max: 1, windowSeconds: 10 },
            { max: 2, windowSeconds: 10 },
          ],
        }),
      ),
    ],
    expected: [
      'MESSAGING_POLICY',
      'MESSAGING_POLICY',
      'MESSAGING_POLICY',
      'MESSAGING_POLICY.editWindowMs',
      'MESSAGING_POLICY.fileUploadsDaily',
      'MESSAGING_POLICY.send',
    ].map((field) => `Invalid server configuration: ${field}`),
  });
});
