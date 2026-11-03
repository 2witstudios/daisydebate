import { assert, setupRitewayBun, test } from 'riteway/bun';
import { encoderArgs, silentEncoderArgs, slateEncoderArgs } from './encoder';

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

test('encoderArgs cuts only when asked, and to the millisecond', () => {
  const output = (rendition: string) => `/o/${rendition}.ts`;
  const whole = encoderArgs('/i.ts', output, 1000);
  const cut = encoderArgs('/i.ts', output, 1000, {
    offsetMs: 1500,
    durationMs: 2250,
  });
  assert({
    given: 'a whole segment, then a cut, three renditions',
    should: 'seek in none, then in each, after the input',
    actual: [
      whole.includes('-ss'),
      cut.filter((arg) => arg === '-ss').length,
      cut.indexOf('-i') < cut.indexOf('-ss'),
      cut.includes('1.500'),
      cut.includes('2.250'),
    ],
    expected: [false, 3, true, true, true],
  });
});

const probeArgs = (args: readonly string[]) => ({
  inputs: args.filter((arg, at) => args[at - 1] === '-i'),
  copies: args.includes('copy'),
  mapped: args.filter((arg, at) => args[at - 1] === '-map'),
});
const named = (rendition: string) => `/o/${rendition}.ts`;

test("a between clip carries the hold's picture, and no byte of its sound", () => {
  const args = probeArgs(
    silentEncoderArgs('/hold.ts', named, 1000, {
      offsetMs: 500,
      durationMs: 1000,
    }),
  );
  assert({
    given: 'the stretch between two speeches',
    should: 'map audio only from generated silence, never copying',
    actual: [
      args.inputs.includes('/hold.ts'),
      args.copies,
      args.mapped.filter((map) => map.endsWith(':a')),
    ],
    expected: [true, false, ['1:a', '1:a', '1:a']],
  });
});

test('a private clip reads nothing from the hold', () => {
  const { inputs, copies } = probeArgs(slateEncoderArgs(named, 1000, 2000));
  assert({
    given: 'a known private span',
    should: 'have only generated inputs',
    actual: [
      inputs.filter((input) => !/^(color|anullsrc)=/.test(input)),
      copies,
    ],
    expected: [[], false],
  });
});
