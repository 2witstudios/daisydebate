import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRefusal } from '@daisy/errors';
import { causeChain, innermostReason, systemCodeOf } from './economics-cause';
setupRitewayBun();

test('a cause chain is read without ever throwing', () => {
  const hostile = new Error('outer');
  Object.defineProperty(hostile, 'cause', {
    get() {
      throw new Error('getter');
    },
  });
  const cyclic = new Error('a');
  Object.assign(cyclic, { cause: cyclic });
  const proxy = new Proxy(new Error('p'), {
    getOwnPropertyDescriptor() {
      throw new Error('trap');
    },
  });
  assert({
    given:
      'a throwing cause getter, a cycle, and a Proxy whose descriptor trap throws',
    should: 'end each chain where it stops being readable',
    actual: [
      causeChain(hostile).length,
      causeChain(cyclic).length,
      causeChain(proxy).length,
    ],
    expected: [1, 1, 1],
  });
});

test('the innermost reason names the actual fault', () => {
  assert({
    given:
      'a stage refusal wrapping a reader refusal wrapping a privacy refusal',
    should: 'name the privacy refusal',
    actual: innermostReason(
      createRefusal(
        'INFRASTRUCTURE',
        'economics-feed-unreadable',
        undefined,
        createRefusal(
          'INFRASTRUCTURE',
          'economics-sink-unreadable',
          undefined,
          createRefusal('VALIDATION', 'economics-sink-not-private'),
        ),
      ),
    ),
    expected: 'economics-sink-not-private',
  });
});

test('a system code reads errno beside code, never through a getter', () => {
  const getter = new Error('g');
  Object.defineProperty(getter, 'code', {
    get() {
      throw new Error('getter');
    },
  });
  assert({
    given:
      'a SQL error carrying code and errno, and an error whose code is a getter',
    should: 'join the own codes, and read nothing from the getter',
    actual: [
      systemCodeOf(
        Object.assign(new Error('x'), {
          code: 'ERR_POSTGRES_SERVER_ERROR',
          errno: '55P03',
        }),
      ),
      systemCodeOf(getter),
    ],
    expected: ['ERR_POSTGRES_SERVER_ERROR/55P03', ''],
  });
});
