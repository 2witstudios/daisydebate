import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roleSeniority } from './role-seniority';

setupRitewayBun();

describe('roleSeniority', () => {
  test('a stored rank as the evaluator compares it', () => {
    assert({
      given: 'the Director (rank 1) and Staff (rank 2) roles',
      should: 'give the Director the greater seniority',
      actual: roleSeniority(1) > roleSeniority(2),
      expected: true,
    });
  });
});
