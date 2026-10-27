import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readAuthConfig, readServerConfig } from './index';
import { authEnv } from './auth-env.test-support';

setupRitewayBun();
const env = {
  ...authEnv,
  DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
  REDIS_URL: 'redis://localhost:6379',
};
const field = 'AUTH_SIGN_UP_MAIL_CEILINGS';

test('global sign-up mail ceilings use defaults or complete validated overrides', () => {
  for (const read of [readAuthConfig, readServerConfig])
    assert({
      given: 'no override and an explicit pair of deployment ceilings',
      should:
        'load existing defaults or exactly the supplied positive integers',
      actual: [
        read(env)[field],
        read({ ...env, [field]: '{"perMinute":7,"perDay":23}' })[field],
      ],
      expected: [
        { perMinute: 120, perDay: 3000 },
        { perMinute: 7, perDay: 23 },
      ],
    });
});

test('invalid ceiling configuration fails closed with field names only', () => {
  const invalid = [
    '',
    'SECRET invalid JSON',
    'null',
    '[]',
    '{}',
    '{"perMinute":1}',
    '{"perMinute":0,"perDay":2}',
    '{"perMinute":-1,"perDay":2}',
    '{"perMinute":1.5,"perDay":2}',
    '{"perMinute":"SECRET","perDay":2}',
    '{"perMinute":1,"perDay":0}',
    '{"perMinute":1,"perDay":9007199254740992}',
    '{"perMinute":1,"perDay":2,"unexpected":true}',
  ];
  for (const read of [readAuthConfig, readServerConfig]) {
    const results = invalid.map((value) => {
      try {
        read({ ...env, [field]: value });
        return 'accepted';
      } catch (error) {
        return (error as Error).message;
      }
    });
    assert({
      given:
        'malformed, partial, nonpositive, fractional, unsafe or unknown configuration',
      should: 'reject every value without echoing its contents',
      actual: results.map(
        (message) => message.includes(field) && !message.includes('SECRET'),
      ),
      expected: invalid.map(() => true),
    });
  }
});
