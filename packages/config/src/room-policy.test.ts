import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readServerConfig } from './index';
setupRitewayBun();
const env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
  REDIS_URL: 'redis://localhost:6379',
  PUBLIC_APP_URL: 'http://localhost:3000',
};
const policy = {
  consentTtlMs: 12345,
  idleTimeoutMs: 600_000,
  maxBodyBytes: 54321,
  limits: {
    create: { max: 13, windowSeconds: 17 },
    read: { max: 19, windowSeconds: 23 },
    command: { max: 29, windowSeconds: 31 },
  },
};
test('optional complete deployment Room policy has no numeric defaults', () => {
  assert({
    given: 'absent or explicitly configured Room policy',
    should: 'leave absence inert and preserve every explicit number',
    actual: [
      readServerConfig(env).ROOM_POLICY,
      readServerConfig({ ...env, ROOM_POLICY: JSON.stringify(policy) })
        .ROOM_POLICY,
    ],
    expected: [undefined, policy],
  });
  const { idleTimeoutMs: _omitted, ...withoutIdle } = policy;
  void _omitted;
  assert({
    given: 'a Room policy without an idle timeout',
    should: 'accept it with idle expiry left inert, never a default',
    actual: readServerConfig({
      ...env,
      ROOM_POLICY: JSON.stringify(withoutIdle),
    }).ROOM_POLICY,
    expected: withoutIdle,
  });
});
test('Room policy refuses malformed partial and invalid fields without values', () => {
  const failure = (value: string) => {
    try {
      readServerConfig({ ...env, ROOM_POLICY: value });
      return 'accepted';
    } catch (error) {
      return (error as Error).message;
    }
  };
  const invalid = [
    '',
    'SECRET broken JSON',
    'null',
    '[]',
    '{}',
    JSON.stringify({ ...policy, idleTimeoutMs: 'SECRET' }),
    JSON.stringify({ ...policy, consentTtlMs: 0 }),
    JSON.stringify({ ...policy, maxBodyBytes: 1.5 }),
    JSON.stringify({ ...policy, idleTimeoutMs: Number.MAX_SAFE_INTEGER + 1 }),
    JSON.stringify({ ...policy, idleTimeoutMs: 0 }),
    JSON.stringify({ ...policy, maxOpenRooms: 5 }),
    JSON.stringify({
      ...policy,
      limits: { ...policy.limits, command: { max: -1, windowSeconds: 0 } },
    }),
    JSON.stringify({ ...policy, extra: 'SECRET' }),
  ];
  const messages = invalid.map(failure);
  assert({
    given:
      'malformed, partial, unknown, nonpositive, fractional or unsafe numeric policy',
    should: 'refuse using only configuration field paths',
    actual: messages.map(
      (message) =>
        message.startsWith('Invalid server configuration: ROOM_POLICY') &&
        !message.includes('SECRET'),
    ),
    expected: invalid.map(() => true),
  });
  assert({
    given: 'a malformed idleTimeoutMs value',
    should: 'name the nested offending field',
    actual: messages[5],
    expected: 'Invalid server configuration: ROOM_POLICY.idleTimeoutMs',
  });
});
