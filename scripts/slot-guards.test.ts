import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resetRefusal, serviceRefusal, worktreeSlot } from './slot-model';

setupRitewayBun();

describe('reset scope', () => {
  const slot = worktreeSlot('abc');
  const allowed = { NODE_ENV: 'development', ALLOW_DATABASE_RESET: 'yes' };

  test('accepts only the current slot databases on loopback', () => {
    assert({
      given: 'reset targets inside and outside this slot',
      should: 'accept the slot dev and test databases and refuse the rest',
      actual: [
        resetRefusal(slot, {
          ...allowed,
          DATABASE_URL: 'postgres://d:p@localhost:15432/daisy_wt_abc',
        }),
        resetRefusal(slot, {
          ...allowed,
          DATABASE_URL: 'postgres://d:p@127.0.0.1:15432/daisy_wt_abc_test',
        }),
        resetRefusal(slot, {
          ...allowed,
          DATABASE_URL: 'postgres://d:p@localhost:15432/daisy_test',
        }),
        resetRefusal(slot, {
          ...allowed,
          DATABASE_URL: 'postgres://d:p@db.example.com:5432/daisy_wt_abc',
        }),
        resetRefusal(slot, {
          NODE_ENV: 'development',
          DATABASE_URL: 'postgres://d:p@localhost:15432/daisy_wt_abc',
        }),
        resetRefusal(slot, {
          ...allowed,
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://d:p@localhost:15432/daisy_wt_abc',
        }),
      ].map((refusal) => refusal === undefined),
      expected: [true, true, false, false, false, false],
    });
  });
});

describe('slot service scope', () => {
  const local = {
    DATABASE_URL: 'postgres://daisy:pw@localhost:15432/daisy',
    REDIS_URL: 'redis://127.0.0.1:6379',
  };

  test('accepts only loopback Postgres and Redis', () => {
    assert({
      given: 'slot administration URLs on loopback and elsewhere',
      should: 'accept the local stack and refuse any other host',
      actual: [
        serviceRefusal(local),
        serviceRefusal({ ...local, E2E_REDIS_URL: 'redis://[::1]:6379/2' }),
        serviceRefusal({
          ...local,
          DATABASE_URL: 'postgres://daisy:pw@db.example.com:5432/daisy',
        }),
        serviceRefusal({ ...local, REDIS_URL: 'rediss://cache.example.com' }),
        serviceRefusal({
          ...local,
          E2E_REDIS_URL: 'redis://10.0.0.5:6379/2',
        }),
        serviceRefusal({ REDIS_URL: local.REDIS_URL }),
        serviceRefusal({ ...local, DATABASE_URL: 'not a url' }),
      ],
      expected: [
        undefined,
        undefined,
        'DATABASE_URL must name the local stack (localhost, 127.0.0.1 or ::1), not db.example.com',
        'REDIS_URL must name the local stack (localhost, 127.0.0.1 or ::1), not cache.example.com',
        'E2E_REDIS_URL must name the local stack (localhost, 127.0.0.1 or ::1), not 10.0.0.5',
        'DATABASE_URL is required in .env',
        'DATABASE_URL is not a valid URL',
      ],
    });
  });
});
