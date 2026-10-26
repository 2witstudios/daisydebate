import { assert, setupRitewayBun, test } from 'riteway/bun';
import { yieldChoiceOf, yieldChoices } from './yield-choice';

setupRitewayBun();

test('ending early offers only the choices the format permits', () => {
  assert({
    given: 'a format permitting every choice and a saved returned yield',
    should:
      'offer off, return and drop, keeping the saved return choice for off',
    actual: yieldChoices(
      { enabledChoices: [true, false], returnsTimeChoices: [true, false] },
      { allowed: true, returnsTime: true },
    ),
    expected: [
      ['off', { allowed: false, returnsTime: true }],
      ['return', { allowed: true, returnsTime: true }],
      ['drop', { allowed: true, returnsTime: false }],
    ],
  });
  assert({
    given: 'a format that only permits dropping time and a saved return',
    should: 'save off with a permitted return choice and offer no return',
    actual: yieldChoices(
      { enabledChoices: [true, false], returnsTimeChoices: [false] },
      { allowed: false, returnsTime: true },
    ),
    expected: [
      ['off', { allowed: false, returnsTime: false }],
      ['drop', { allowed: true, returnsTime: false }],
    ],
  });
});

test('a saved yielding config reads as its one choice', () => {
  assert({
    given: 'off, on dropping time and on returning time',
    should: 'name each choice',
    actual: [
      yieldChoiceOf({ allowed: false, returnsTime: true }),
      yieldChoiceOf({ allowed: true, returnsTime: false }),
      yieldChoiceOf({ allowed: true, returnsTime: true }),
    ],
    expected: ['off', 'drop', 'return'],
  });
});
