import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { refusedNotice, RETRYING_NOTICE } from './save-notice';

setupRitewayBun();

describe('refusedNotice', () => {
  test('what to do about each refusal', () => {
    assert({
      given:
        'a file refused as too large or too complex, a signed-out save, and anything else',
      should: 'say what to do, and never claim it is retrying',
      actual: [413, 422, 400, 401, 403, 404].map(refusedNotice),
      expected: [
        'This file is too large to save. Shorten it.',
        'This file is too large to save. Shorten it.',
        'This file is too large to save. Shorten it.',
        'Sign in again to save your changes.',
        'Sign in again to save your changes.',
        'This file can no longer be saved. Reload the page.',
      ],
    });
  });

  test('distinct from retrying', () => {
    assert({
      given: 'the retrying notice',
      should: 'differ from every refusal notice',
      actual: [413, 401, 404].map(refusedNotice).includes(RETRYING_NOTICE),
      expected: false,
    });
  });
});
