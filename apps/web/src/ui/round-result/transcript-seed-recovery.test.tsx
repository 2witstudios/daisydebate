import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { TranscriptSeedAnswer } from './transcript-seed-recovery';

setupRitewayBun();

const html = (
  kind: 'asking' | 'denied' | 'outdated',
  placement: 'card' | 'sidebar',
) =>
  renderToStaticMarkup(
    <TranscriptSeedAnswer
      state={{ kind }}
      socketUrl={null}
      placement={placement}
    />,
  );

test('what a refused seed shows while it recovers', () => {
  assert({
    given: 'a denial in a card and in the always-open sidebar',
    should: 'leave a card empty and never a sidebar panel blank',
    actual: [
      html('denied', 'card'),
      html('denied', 'sidebar').includes('Transcript unavailable.'),
    ],
    expected: ['', true],
  });
  assert({
    given: 'an outdated answer',
    should: 'offer a reload button',
    actual: html('outdated', 'sidebar').includes('>Reload</button>'),
    expected: true,
  });
});
