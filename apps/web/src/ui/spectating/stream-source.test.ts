import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { chooseStreamEngine, capturedJumped } from './stream-source';

setupRitewayBun();

describe('chooseStreamEngine', () => {
  test('each browser gets its player', () => {
    assert({
      given: 'macOS Safari, with both native HLS and MSE',
      should: 'play natively',
      actual: chooseStreamEngine({ mse: true, nativeHls: true, apple: true }),
      expected: 'native',
    });
    assert({
      given: 'iOS Safari, with native HLS and no MSE',
      should: 'play natively',
      actual: chooseStreamEngine({ mse: false, nativeHls: true, apple: true }),
      expected: 'native',
    });
    assert({
      given: 'Chrome, which may also report native HLS',
      should: 'use hls.js, the player its targets were measured on',
      actual: chooseStreamEngine({ mse: true, nativeHls: true, apple: false }),
      expected: 'hlsjs',
    });
    assert({
      given: 'a browser with no MSE that plays HLS itself',
      should: 'play natively',
      actual: chooseStreamEngine({ mse: false, nativeHls: true, apple: false }),
      expected: 'native',
    });
    assert({
      given: 'a browser that can do neither',
      should: 'have no engine',
      actual: chooseStreamEngine({
        mse: false,
        nativeHls: false,
        apple: false,
      }),
      expected: null,
    });
  });
});

test('capture time jumping marks a stretch that was never published', () => {
  assert({
    given: 'nothing before, the next segment, and 30 s on',
    should: 'mark only the last',
    actual: [
      capturedJumped(null, 1000),
      capturedJumped(1000, 5000),
      capturedJumped(5000, 35_000),
    ],
    expected: [false, false, true],
  });
});
