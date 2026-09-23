import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resetRefusal, worktreeSlot } from './slot-model';

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
