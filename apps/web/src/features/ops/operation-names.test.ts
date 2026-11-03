import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isOperationName } from './operation-names';

setupRitewayBun();

describe('isOperationName (ISSUE-1009)', () => {
  test('admits only listed names', () => {
    assert({
      given: 'a listed name, an unlisted one and a non-string',
      should: 'admit only the listed name',
      actual: [
        isOperationName('messaging.inbox'),
        isOperationName('not.a.route'),
        isOperationName(undefined),
      ],
      expected: [true, false, false],
    });
  });
});
