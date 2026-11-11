import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assertNever } from './assert-never';

setupRitewayBun();

describe('assertNever', () => {
  test('a value outside the union is refused by name', () => {
    let message = '';
    try {
      assertNever('paused' as never);
    } catch (error) {
      message = (error as Error).message;
    }
    assert({
      given: 'a value no case of the union handled',
      should: 'throw naming it',
      actual: message,
      expected: 'Unhandled union member: "paused"',
    });
  });
});
