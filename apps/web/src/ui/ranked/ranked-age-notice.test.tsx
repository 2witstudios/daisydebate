import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RankedAgeNotice } from './ranked-age-notice';
import { rankedAgeReason } from '../../features/play/ranked-age';

setupRitewayBun();

test('the ranked age notice says why, in plain words', () => {
  const html = renderToString(h(RankedAgeNotice));
  assert({
    given: 'a member under the ranked floor where a ranked control would be',
    should: 'say who ranked play is for and that a Scholastic ladder is coming',
    actual: [
      html.includes('Ranked play is for members 18 and over.'),
      html.includes('A Scholastic ladder for members under 18 is coming.'),
      rankedAgeReason,
      /<a /.test(html),
    ],
    expected: [
      true,
      true,
      'Ranked play is for members 18 and over. A Scholastic ladder for members under 18 is coming.',
      false,
    ],
  });
});
