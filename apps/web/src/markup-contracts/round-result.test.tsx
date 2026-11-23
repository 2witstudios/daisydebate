import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { completed } from '../ui/round-result/result.test-support';
import { RoundResult } from '../ui/round-result/round-result';

setupRitewayBun();

/**
 * The element itself is the contract: inside the receipt's main landmark a
 * `<header>` is not a banner, so the accessibility tree cannot show that the
 * result adds none.
 */
test('the result adds no header of its own', () => {
  assert({
    given: 'the result inside the receipt’s main landmark',
    should: 'add no header, so the receipt’s header stays the page’s only one',
    actual: renderMarkup(
      <RoundResult reportAction={() => {}} view={completed} />,
    ).includes('<header'),
    expected: false,
  });
});
