import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  ACCOUNT_AGE_FLOOR,
  ADMITTED_AGE_BANDS,
  ageBandAdmitted,
} from './age-floor';
import { ageBands } from './ladder';

setupRitewayBun();

test('the member floor is 13 and admits every band from 13-15 up (decision 88)', () => {
  assert({
    given: 'the floor, its bands, and each band and no band at all',
    should: 'be 13, admit 13-15, 16-17 and adult, and refuse under 13 and none',
    actual: [
      ACCOUNT_AGE_FLOOR,
      ADMITTED_AGE_BANDS,
      [...ageBands, null].map(ageBandAdmitted),
    ],
    expected: [
      13,
      ['13-15', '16-17', 'adult'],
      [false, true, true, true, false],
    ],
  });
});
