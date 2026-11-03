import { assert, setupRitewayBun, test } from 'riteway/bun';
import { encoderArgs } from './encoder';

setupRitewayBun();

test('encoderArgs writes all three renditions, keeping capture timestamps', () => {
  const args = encoderArgs('/tmp/in.ts', (name) => `/tmp/out-${name}.ts`);
  assert({
    given: 'a held segment',
    should:
      'keep timestamps so segments join, and write 720p, 480p and 240p with audio copied',
    actual: [
      args.slice(0, 5),
      args.filter((a) => a.startsWith('scale=')),
      args.filter((a) => a.startsWith('/tmp/out-')),
      args.filter((a, i) => args[i - 1] === '-c:a'),
    ],
    expected: [
      ['ffmpeg', '-y', '-loglevel', 'error', '-copyts'],
      ['scale=1280:720', 'scale=854:480', 'scale=426:240'],
      ['/tmp/out-720.ts', '/tmp/out-480.ts', '/tmp/out-240.ts'],
      ['copy', 'copy', 'copy'],
    ],
  });
});
