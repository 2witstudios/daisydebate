import { assert, setupRitewayBun, test } from 'riteway/bun';
import { retriedOnceIfQueuedMeanwhile } from './mail-queue';

setupRitewayBun();

const uniqueViolation = () =>
  Object.assign(new Error('duplicate key'), { errno: '23505' });

test('retriedOnceIfQueuedMeanwhile', async () => {
  let calls = 0;
  const raced = await retriedOnceIfQueuedMeanwhile(async () => {
    calls += 1;
    if (calls === 1) throw uniqueViolation();
    return 'joined';
  });
  const other = await retriedOnceIfQueuedMeanwhile(async () => {
    throw new Error('connection lost');
  }).catch((error: Error) => error.message);
  let twice = 0;
  const lostTwice = await retriedOnceIfQueuedMeanwhile(async () => {
    twice += 1;
    throw uniqueViolation();
  }).catch(() => 'refused');
  assert({
    given:
      'a postponement that lost the queued place once, one that failed otherwise, and one that lost it twice',
    should:
      'run the first again and return its answer, pass the other failure on, and try no more than twice',
    actual: { raced, calls, other, lostTwice, twice },
    expected: {
      raced: 'joined',
      calls: 2,
      other: 'connection lost',
      lostTwice: 'refused',
      twice: 2,
    },
  });
});
