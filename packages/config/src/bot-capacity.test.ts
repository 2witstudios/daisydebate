import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readServerConfig } from './index';
setupRitewayBun();
const env = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://user:secret@localhost:5432/daisy',
  REDIS_URL: 'redis://localhost:6379',
  PUBLIC_APP_URL: 'http://localhost:3000',
};
test('AI Round admission requires an explicit server capacity bound', () => {
  assert({
    given: 'missing or explicit local proof capacity',
    should:
      'retain absence or the configured bound without an entitlement default',
    actual: [
      readServerConfig(env).AI_ROUND_BUSY_CAP,
      readServerConfig({ ...env, AI_ROUND_BUSY_CAP: '4' }).AI_ROUND_BUSY_CAP,
    ],
    expected: [undefined, 4],
  });
  for (const value of ['', '0', '-1', '1.5', 'Infinity', '9007199254740992'])
    expect(() =>
      readServerConfig({ ...env, AI_ROUND_BUSY_CAP: value }),
    ).toThrow('Invalid server configuration: AI_ROUND_BUSY_CAP');
});
