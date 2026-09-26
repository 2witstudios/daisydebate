import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  refusalFor,
  refusalForRedis,
  refusalForStagingSeed,
} from './restore-guard';

setupRitewayBun();

describe('restore-guard: refusalFor', () => {
  test('allows a database name naming itself a restore copy', () => {
    assert({
      given: 'a DATABASE_URL whose database name contains "restore"',
      should: 'not refuse',
      actual: refusalFor(
        'postgres://u:p@host:5432/daisy_debate_restore_rehearsal',
        false,
      ),
      expected: undefined,
    });
  });

  test('is case-insensitive about the "restore" marker', () => {
    assert({
      given: 'a database name with "Restore" capitalized',
      should: 'not refuse',
      actual: refusalFor('postgres://u:p@host:5432/Daisy_Restore', false),
      expected: undefined,
    });
  });

  test('refuses a database name with no restore marker', () => {
    assert({
      given: 'the live staging database name',
      should: 'refuse with a message naming the database',
      actual: refusalFor(
        'postgres://u:p@host:5432/daisy_debate_staging',
        false,
      )?.includes('daisy_debate_staging'),
      expected: true,
    });
  });

  test('--force overrides the name check', () => {
    assert({
      given: 'force true and a database name with no restore marker',
      should: 'not refuse',
      actual: refusalFor('postgres://u:p@host:5432/anything', true),
      expected: undefined,
    });
  });
});

describe('restore-guard: refusalForStagingSeed', () => {
  test('allows a database name naming itself staging', () => {
    assert({
      given: 'a DATABASE_URL whose database name contains "staging"',
      should: 'not refuse',
      actual: refusalForStagingSeed(
        'postgres://u:p@host:5432/daisy_debate_staging',
        false,
      ),
      expected: undefined,
    });
  });

  test('refuses a database name with no staging marker', () => {
    assert({
      given: 'a production-shaped database name',
      should: 'refuse with a message naming the database',
      actual: refusalForStagingSeed(
        'postgres://u:p@host:5432/daisy_debate',
        false,
      )?.includes('daisy_debate'),
      expected: true,
    });
  });

  test('--force overrides the name check', () => {
    assert({
      given: 'force true and a database name with no staging marker',
      should: 'not refuse',
      actual: refusalForStagingSeed('postgres://u:p@host:5432/anything', true),
      expected: undefined,
    });
  });
});

describe('restore-guard: refusalForRedis', () => {
  const url = 'redis://:secret-password@redis.internal:6379';

  test('allows a namespace with no naming convention when both are explicitly confirmed', () => {
    assert({
      given:
        '--confirm-redis-namespace and --confirm-redis-host matching exactly, even "daisy"',
      should: 'not refuse',
      actual: refusalForRedis(url, 'daisy', 'daisy', 'redis.internal:6379'),
      expected: undefined,
    });
  });

  test('refuses when no confirmation was passed', () => {
    assert({
      given: 'no --confirm-redis-namespace or --confirm-redis-host at all',
      should: 'refuse with a message naming the namespace and the host',
      actual: [
        refusalForRedis(
          url,
          'daisy-restore-rehearsal',
          undefined,
          undefined,
        )?.includes('daisy-restore-rehearsal'),
        refusalForRedis(
          url,
          'daisy-restore-rehearsal',
          undefined,
          undefined,
        )?.includes('redis.internal:6379'),
      ],
      expected: [true, true],
    });
  });

  test('never includes the password from REDIS_URL in its refusal message', () => {
    assert({
      given: 'a REDIS_URL carrying a password',
      should: 'never echo the password back',
      actual: refusalForRedis(url, 'daisy', undefined, undefined)?.includes(
        'secret-password',
      ),
      expected: false,
    });
  });

  test('refuses when the namespace confirmation does not match', () => {
    assert({
      given: 'a namespace confirmation for a different namespace, host correct',
      should: 'refuse',
      actual:
        refusalForRedis(
          url,
          'daisy-restore-rehearsal',
          'daisy',
          'redis.internal:6379',
        ) === undefined,
      expected: false,
    });
  });

  test('refuses when the host confirmation does not match', () => {
    assert({
      given: 'a host confirmation for a different host, namespace correct',
      should: 'refuse',
      actual:
        refusalForRedis(url, 'daisy', 'daisy', 'some-other-host:6379') ===
        undefined,
      expected: false,
    });
  });
});
