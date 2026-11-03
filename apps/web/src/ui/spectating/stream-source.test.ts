import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { chooseStreamEngine } from './stream-source';

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
