import { assert, setupRitewayBun, test } from 'riteway/bun';
import { robotsHeaderOf, robotsMetadataOf } from './search-indexing';

setupRitewayBun();

test('search engines read a deployment only where it opened itself', () => {
  assert({
    given: 'a closed deployment',
    should: 'refuse indexing and following by header and by metadata',
    actual: [robotsHeaderOf('closed'), robotsMetadataOf('closed')],
    expected: ['noindex, nofollow', { index: false, follow: false }],
  });
  assert({
    given: 'an open deployment',
    should: 'say nothing, leaving each page its own rule',
    actual: [robotsHeaderOf('open'), robotsMetadataOf('open')],
    expected: [null, undefined],
  });
});
