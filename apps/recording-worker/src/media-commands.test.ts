import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { encodedMsOf, hlsArgs } from './media-commands';

setupRitewayBun();

describe('encodedMsOf', () => {
  test('reads the newest count ffmpeg gave', () => {
    assert({
      given: 'two progress blocks, and nothing to read',
      should: 'answer the newest in milliseconds, or nothing',
      actual: [
        encodedMsOf(
          'frame=1\nout_time_us=1500000\nprogress=continue\nout_time_us=2500000\nprogress=end\n',
        ),
        encodedMsOf('out_time_us=N/A\nprogress=continue\n'),
        encodedMsOf(''),
      ],
      expected: [2500, null, null],
    });
  });
});

describe('hlsArgs', () => {
  test('asks ffmpeg to count, before its input', () => {
    const args = hlsArgs('in.mp4', 'out');
    assert({
      given: 'the encode',
      should: 'send machine progress to stdout, as a global option',
      actual: [
        args.indexOf('-progress') > 0,
        args.indexOf('-progress') < args.indexOf('-i'),
        args[args.indexOf('-progress') + 1],
      ],
      expected: [true, true, 'pipe:1'],
    });
  });
});
