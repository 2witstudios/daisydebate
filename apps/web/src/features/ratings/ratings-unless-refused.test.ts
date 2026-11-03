import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { ratingsUnlessRefused } from './ratings-unless-refused';

setupRitewayBun();

test('a refused ratings read only omits ratings', async () => {
  assert({
    given: 'a ratings read that answers, and one that is refused',
    should: 'keep the answer, and omit the ratings for the refusal',
    actual: [
      await ratingsUnlessRefused(async () => 'ratings'),
      await ratingsUnlessRefused(() => Promise.reject(refuseCapacity())),
    ],
    expected: ['ratings', null],
  });
  await assertRejects({
    given: 'a ratings read that really fails',
    should: 'still fail',
    actual: () =>
      ratingsUnlessRefused(() => Promise.reject(createAppError('INTERNAL'))),
    code: 'INTERNAL',
  });
});
