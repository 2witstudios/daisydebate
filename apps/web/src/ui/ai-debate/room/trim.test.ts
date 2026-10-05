import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { voicedRange } from './trim';

setupRitewayBun();

describe('voicedRange', () => {
  test('cuts the silence before and after the voice, keeping a short margin', () => {
    const rate = 1_000; // one sample per millisecond keeps the numbers readable
    const samples = new Float32Array(1_000);
    for (let index = 300; index < 700; index += 1)
      samples[index] = Math.sin(index) * 0.5;
    assert({
      given: '300 ms of silence, 400 ms of voice, then 300 ms of silence',
      should: 'keep the voice with 20 ms either side',
      actual: voicedRange(samples, rate),
      expected: { start: 280, end: 720 },
    });
  });

  test('keeps a clip that is all silence whole', () => {
    assert({
      given: 'a clip with no voice in it',
      should: 'keep it as it is',
      actual: voicedRange(new Float32Array(500), 1_000),
      expected: { start: 0, end: 500 },
    });
  });
});
