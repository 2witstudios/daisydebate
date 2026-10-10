import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { catchupWindow } from './outbox-catchup';

setupRitewayBun();
describe('retained catchup window', () => {
  for (const [since, floor, through, count, expected] of [
    ['1:2', '1:1', '2:3', 2, true],
    ['1:1', '2:2', '3:3', 1, false],
    ['2:3', '1:1', '2:3', 0, true],
    ['0:0', '1:1', '2:3', 2, false],
    ['3:1', '1:1', '2:3', 2, false],
    ['1:2', '1:1', '2:3', 4, false],
    ['1:2', null, '2:3', 0, false],
  ] as const)
    test(`window ${since}/${floor}/${count}`, () => {
      assert({
        given: 'cursor bounds, retained floor and bounded row count',
        should: 'allow only a complete retained window',
        actual: catchupWindow({ since, floor, through, count, limit: 3 }),
        expected,
      });
    });
});
