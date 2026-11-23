import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { CountedTextarea, characterCountText } from './counted-textarea';
setupRitewayBun();

test('the character count states UTF-16 units against the limit', () => {
  assert({
    given: 'text within the limit',
    should: 'show the count and the limit',
    actual: characterCountText(12, 4000),
    expected: { count: '12 / 4,000 characters', over: null },
  });
  assert({
    given: 'text exactly at the limit',
    should: 'still be within it',
    actual: characterCountText(4000, 4000).over,
    expected: null,
  });
  assert({
    given: 'text one unit over the limit',
    should: 'say how far over it is and that it must be shortened',
    actual: characterCountText(4001, 4000),
    expected: {
      count: '4,001 / 4,000 characters',
      over: '1 character over the limit. Shorten it to send.',
    },
  });
  assert({
    given: 'text several units over',
    should: 'use the plural',
    actual: characterCountText(4003, 4000).over,
    expected: '3 characters over the limit. Shorten it to send.',
  });
});

/** The field, and the text each id in its aria-describedby points at. */
const describedField = (view: AccessibleView) => {
  const field = view.get('textbox') as HTMLTextAreaElement;
  const ids = (field.getAttribute('aria-describedby') ?? '').split(' ');
  return {
    field,
    ids,
    by: (id: string) => field.ownerDocument.getElementById(id),
  };
};

test('a counted field never truncates and describes itself by its count', () => {
  const emoji = describedField(
    renderAccessible(
      <CountedTextarea
        id="text"
        name="text"
        maxUnits={10}
        defaultValue="😀😀"
      />,
    ),
  );
  assert({
    given: 'two supplementary characters',
    should: 'count four UTF-16 units, link the count, and set no maxlength',
    actual: [
      emoji.by('text-count')?.textContent,
      emoji.ids,
      emoji.field.hasAttribute('maxlength'),
      emoji.field.hasAttribute('aria-invalid'),
    ],
    expected: ['4 / 10 characters', ['text-count'], false, false],
  });
  const keptView = renderAccessible(
    <CountedTextarea
      id="text"
      name="text"
      maxUnits={3}
      defaultValue="abcd"
      describedBy="notice"
    />,
  );
  const kept = describedField(keptView);
  const over = kept.by('text-over');
  assert({
    given: 'a kept draft already over the limit',
    should:
      'keep every character, mark it invalid and announce the overage politely without a second status region',
    actual: [
      kept.field.value,
      kept.field.getAttribute('aria-invalid'),
      kept.ids,
      ['status', 'alert', 'log'].map((role) => keptView.count(role)),
      over?.getAttribute('aria-live'),
      over?.textContent,
    ],
    expected: [
      'abcd',
      'true',
      ['notice', 'text-count', 'text-over'],
      [0, 0, 0],
      'polite',
      '1 character over the limit. Shorten it to send.',
    ],
  });
});
