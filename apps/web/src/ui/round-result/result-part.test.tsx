import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ResultPart } from './result-part';
import { mockNextRouter } from '../../lib/testing/mock-router';
import { renderAccessible } from '../../test-support/rendered/accessible';

await mockNextRouter();
const { ResultUnavailable, resultPart, resultRetryOf } =
  await import('./result-part');

setupRitewayBun();

test('a result part tells nothing to show from not read (ISSUE-1150)', () => {
  assert({
    given: 'each way a read of part of the result can end',
    should: 'keep what was found, and flag only a read that failed',
    actual: [
      resultPart({ kind: 'found', view: 'decision' }, ({ view }) => view),
      resultPart({ kind: 'missing' }, () => 'never'),
      resultPart({ kind: 'unavailable' }, () => 'never'),
      resultPart({ kind: 'unavailable', temporary: true }, () => 'never'),
    ],
    expected: [
      { value: 'decision', failure: null },
      { value: null, failure: null },
      { value: null, failure: 'lasting' },
      { value: null, failure: 'temporary' },
    ],
  });
});

test('the page refreshes only when asking again can help', () => {
  const part = (failure: ResultPart<never>['failure']) => ({
    value: null,
    failure,
  });
  assert({
    given: 'the parts of a result, each read or not',
    should:
      'refresh for a temporary failure, never while any failure may be lasting',
    actual: [
      resultRetryOf([part(null), part(null)]),
      resultRetryOf([part('temporary'), part(null)]),
      resultRetryOf([part('lasting'), part(null)]),
      resultRetryOf([part('temporary'), part('lasting')]),
    ],
    expected: [null, 'refresh', 'reload', 'reload'],
  });
});

test('a temporary failure is announced and tried again by itself', () => {
  const view = renderAccessible(<ResultUnavailable retrySeconds={3} />);
  // The `href=""` that asks again in place: markup-contracts/result-part.
  assert({
    given: 'a part refused for now',
    should: 'announce it and offer it now',
    actual: [view.has('status'), view.textContent().includes('Try now')],
    expected: [true, true],
  });
});

test('a failure that may last is announced with no refresh loop', () => {
  const view = renderAccessible(<ResultUnavailable retrySeconds={null} />);
  assert({
    given: 'a part whose failure may never pass',
    should: 'announce it and leave asking again to the reader',
    actual: [
      view.has('status'),
      view.text('status').includes('Trying again'),
      view.textContent().includes('Try now'),
    ],
    expected: [true, false, true],
  });
});
