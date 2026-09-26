import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { refusalFor } from './restore-guard';

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
