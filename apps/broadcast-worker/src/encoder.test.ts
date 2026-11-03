import { assert, setupRitewayBun, test } from 'riteway/bun';
import { encoderArgs } from './encoder';

setupRitewayBun();

test('encoderArgs writes all three renditions, timed by capture', () => {
  const args = encoderArgs(
    '/tmp/in.ts',
    (name) => `/tmp/out-${name}.ts`,
    1_000_000,
  );
  assert({
    given: 'a held segment',
    should:
      'time them by capture so segments join across an Egress restart, and write 720p, 480p and 240p with audio copied',
    actual: [
      args.slice(0, 4),
      args.filter((a, i) => args[i - 1] === '-output_ts_offset'),
      args.filter((a) => a.startsWith('scale=')),
      args.filter((a) => a.startsWith('/tmp/out-')),
      args.filter((a, i) => args[i - 1] === '-c:a'),
    ],
    expected: [
      ['ffmpeg', '-y', '-loglevel', 'error'],
      ['1000.000', '1000.000', '1000.000'],
      ['scale=1280:720', 'scale=854:480', 'scale=426:240'],
      ['/tmp/out-720.ts', '/tmp/out-480.ts', '/tmp/out-240.ts'],
      ['copy', 'copy', 'copy'],
    ],
  });
});
