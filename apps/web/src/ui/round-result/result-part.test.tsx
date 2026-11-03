import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ResultRetry, resultPart } from './result-part';

setupRitewayBun();

test('a result part tells nothing to show from not read (ISSUE-1150)', () => {
  assert({
    given: 'each way a read of part of the result can end',
    should: 'keep what was found, and flag only a read that failed',
    actual: [
      resultPart({ kind: 'found', view: 'decision' }, ({ view }) => view),
      resultPart({ kind: 'missing' }, () => 'never'),
      resultPart({ kind: 'unavailable' }, () => 'never'),
    ],
    expected: [
      { value: 'decision', unavailable: false },
      { value: null, unavailable: false },
      { value: null, unavailable: true },
    ],
  });
});

test('a part not read is announced, and the page tries again by itself', () => {
  const html = renderToStaticMarkup(<ResultRetry retrySeconds={3} />);
  assert({
    given: 'a finished Round with a part not read',
    should: 'announce it, refresh as a plain GET and offer it now',
    actual: [
      html.includes('role="status"'),
      html.includes('http-equiv="refresh"'),
      html.includes('content="3"'),
      html.includes('href=""'),
    ],
    expected: [true, true, true, true],
  });
});
