import { assert, setupRitewayBun, test } from 'riteway/bun';
import { keepForRewind, rewoundPhrase } from './speech-rewind';
setupRitewayBun();

const phrase = (seconds: number) => ({ pcm: { length: seconds * 24000 } });
const said = new Map([
  [0, phrase(2)],
  [1, phrase(2)],
  [2, phrase(2)],
]);
const at = (unheardSeconds: number, sentSeconds = 1) =>
  rewoundPhrase({
    spoken: 3,
    sent: sentSeconds * 24000,
    said,
    unheardSamples: unheardSeconds * 24000,
  });

test('a rewind reaches the phrase whose start covers what was unheard', () => {
  assert({
    given: 'one second into a phrase, unheard speech of growing length',
    should: 'stay on it, then step back a phrase at a time',
    actual: [at(0.5), at(1), at(1.5), at(3), at(3.5), at(5.5)],
    expected: [3, 3, 2, 2, 1, 0],
  });
  assert({
    given: 'more unheard speech than any phrase still held',
    should: 'stop at the oldest it holds',
    actual: at(60),
    expected: 0,
  });
});

test('a speech keeps only what a rewind can reach', () => {
  let kept: ReadonlyMap<number, ReturnType<typeof phrase>> = new Map();
  for (let index = 0; index < 8; index += 1)
    kept = keepForRewind(kept, index, phrase(10));
  assert({
    given: 'eight ten-second phrases, past the thirty seconds a rewind reaches',
    should: 'keep the newest that reach it, and let the rest go',
    actual: [...kept.keys()],
    expected: [5, 6, 7],
  });
});
