import { renderAccessible } from '../../test-support/rendered/accessible';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { TranscriptSeedAnswer } from './transcript-seed-recovery';

setupRitewayBun();

const render = (
  kind: 'asking' | 'denied' | 'outdated',
  placement: 'card' | 'sidebar',
) =>
  renderAccessible(
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
      render('denied', 'card').textContent(),
      render('denied', 'sidebar')
        .textContent()
        .includes('Transcript unavailable.'),
    ],
    expected: ['', true],
  });
  assert({
    given: 'an outdated answer',
    should: 'offer a reload button',
    actual: render('outdated', 'sidebar').has('button', 'Reload'),
    expected: true,
  });
});
