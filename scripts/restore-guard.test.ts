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
  test('allows a namespace with no naming convention when explicitly confirmed', () => {
    assert({
      given:
        '--confirm-redis-namespace matching REDIS_NAMESPACE exactly, even "daisy"',
      should: 'not refuse',
      actual: refusalForRedis('daisy', 'daisy'),
      expected: undefined,
    });
  });

  test('refuses when no confirmation was passed', () => {
    assert({
      given: 'no --confirm-redis-namespace at all',
      should: 'refuse with a message naming the namespace',
      actual: refusalForRedis('daisy-restore-rehearsal', undefined)?.includes(
        'daisy-restore-rehearsal',
      ),
      expected: true,
    });
  });

  test('refuses when the confirmation does not match REDIS_NAMESPACE exactly', () => {
    assert({
      given: 'a confirmation for a different namespace than REDIS_NAMESPACE',
      should: 'refuse',
      actual: refusalForRedis('daisy-restore-rehearsal', 'daisy') === undefined,
      expected: false,
    });
  });
});
