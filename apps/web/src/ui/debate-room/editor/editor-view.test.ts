import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { stepTextSize, toolbarFocus } from './editor-view';

setupRitewayBun();

describe('stepTextSize', () => {
  test('steps and ends', () => {
    assert({
      given: 'smaller and larger from the middle and from each end',
      should: 'move one size and hold at the ends',
      actual: [
        stepTextSize('md', 1),
        stepTextSize('md', -1),
        stepTextSize('sm', -1),
        stepTextSize('xl', 1),
      ],
      expected: ['lg', 'sm', 'sm', 'xl'],
    });
  });
});

describe('toolbarFocus', () => {
  test('arrow keys, Home and End', () => {
    assert({
      given: 'focus on the last of ten tools, then the first',
      should: 'wrap with the arrows and jump with Home and End',
      actual: [
        toolbarFocus('ArrowRight', 9, 10),
        toolbarFocus('ArrowLeft', 0, 10),
        toolbarFocus('Home', 5, 10),
        toolbarFocus('End', 5, 10),
      ],
      expected: [0, 9, 0, 9],
    });
  });

  test('other keys', () => {
    assert({
      given: 'a letter and Tab',
      should: 'leave focus to the browser',
      actual: [toolbarFocus('a', 2, 10), toolbarFocus('Tab', 2, 10)],
      expected: [null, null],
    });
  });
});
