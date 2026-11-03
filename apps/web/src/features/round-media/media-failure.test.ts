import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mediaFailure, requestFailureOf } from './media-failure';

setupRitewayBun();

test('the one classifier names every media answer', () => {
  const kinds = (statuses: readonly number[]) =>
    statuses.map((status) => requestFailureOf(mediaFailure(status)));
  assert({
    given:
      'answers that may pass, answers about authority, and everything else',
    should: 'class each by whether it can pass by itself',
    actual: [
      kinds([408, 429, 500, 502, 503, 504, 507, 520]),
      kinds([401, 403, 404, 410]),
      kinds([409]),
      kinds([400, 422]),
    ],
    expected: [
      Array(8).fill('transient'),
      Array(4).fill('refused'),
      ['ending'],
      Array(2).fill('definite'),
    ],
  });
});

test('an error that only claims a name mints no media authority', () => {
  const named = Object.assign(new Error('forged'), {
    name: 'MediaRefusedError',
  });
  assert({
    given: 'a plain error named like a refusal, and something not an error',
    should: 'class both as definite, which leaves a live connection up',
    actual: [requestFailureOf(named), requestFailureOf('refused')],
    expected: ['definite', 'definite'],
  });
});
