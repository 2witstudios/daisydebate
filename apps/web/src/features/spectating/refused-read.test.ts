import { refuseCapacity } from '@daisy/db/testing';
import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { answerUnlessRefused, readUnlessRefused } from './refused-read';

setupRitewayBun();

const refusal = () => refuseCapacity({ lane: 'audience', reason: 'saturated' });
const standing = refuseCapacity({ lane: 'audience', reason: 'unconfigured' });

test('a page keeps standing when the audience lane is full', async () => {
  assert({
    given: 'a read that answers, and one the lane refused',
    should: 'answer it, then leave the fallback',
    actual: [
      await readUnlessRefused(async () => 'read', 'refused'),
      await readUnlessRefused(() => Promise.reject(refusal()), 'refused'),
    ],
    expected: ['read', 'refused'],
  });
});

test('only a refusal asking again can clear is an answer', async () => {
  await expect(
    readUnlessRefused(() => Promise.reject(standing), null),
  ).rejects.toBe(standing);
  await expect(
    answerUnlessRefused(() => Promise.reject(new Error('down'))),
  ).rejects.toThrow('down');
});

test('a route answers a refusal with when to come back', async () => {
  const response = await answerUnlessRefused(() => Promise.reject(refusal()));
  assert({
    given: 'an audience read the lane refused',
    should: 'answer 503 and say when to come back',
    actual: [response.status, response.headers.get('Retry-After')],
    expected: [503, '2'],
  });
});
