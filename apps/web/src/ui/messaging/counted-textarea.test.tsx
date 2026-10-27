import { renderToStaticMarkup } from 'react-dom/server';
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

test('a counted field never truncates and describes itself by its count', () => {
  const emoji = renderToStaticMarkup(
    <CountedTextarea id="text" name="text" maxUnits={10} defaultValue="😀😀" />,
  );
  assert({
    given: 'two supplementary characters',
    should: 'count four UTF-16 units, link the count, and set no maxlength',
    actual: [
      emoji.includes('4 / 10 characters'),
      emoji.includes('aria-describedby="text-count"'),
      emoji.toLowerCase().includes('maxlength'),
      emoji.includes('aria-invalid'),
    ],
    expected: [true, true, false, false],
  });
  const kept = renderToStaticMarkup(
    <CountedTextarea
      id="text"
      name="text"
      maxUnits={3}
      defaultValue="abcd"
      describedBy="notice"
    />,
  );
  assert({
    given: 'a kept draft already over the limit',
    should: 'keep every character, mark it invalid and announce the overage',
    actual: [
      kept.includes('>abcd</textarea>'),
      kept.includes('aria-invalid="true"'),
      kept.includes('aria-describedby="notice text-count text-over"'),
      /role="status"[^>]*>1 character over the limit\. Shorten it to send\.</.test(
        kept,
      ),
    ],
    expected: [true, true, true, true],
  });
});
