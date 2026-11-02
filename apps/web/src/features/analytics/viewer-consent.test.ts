import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { readViewerConsent } from './viewer-consent';

setupRitewayBun();

const stored = { analytics: 'granted' } as never;
const read = (answer: () => Promise<unknown>) =>
  readViewerConsent(answer as never, 'user');

test('a refused consent read costs a page analytics, never its render', async () => {
  assert({
    given: 'a consent read that answers, finds nothing, and is refused',
    should: 'answer each, and invent no consent for the refusal',
    actual: [
      await read(async () => stored),
      await read(async () => null),
      await read(async () => {
        throw new Error('driver', { cause: refuseCapacity() });
      }),
    ],
    expected: [
      { refused: false, stored },
      { refused: false, stored: null },
      { refused: true, stored: null },
    ],
  });
  await assertRejects({
    given: 'a consent read that really fails',
    should: 'keep failing',
    actual: () =>
      read(async () => {
        throw createAppError('INTERNAL');
      }),
    code: 'INTERNAL',
  });
});
