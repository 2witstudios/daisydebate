import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { encodePcmWave } from './pcm-wave';
setupRitewayBun();
test('PCM WAV encoding preserves every signed sample including a short quiet frame', () => {
  const quiet = new Int16Array(160),
    voice = new Int16Array(160);
  voice.set([0, 1, -1, 32767, -32768]);
  const bytes = encodePcmWave([quiet, voice]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = Array.from({ length: 320 }, (_, index) =>
    view.getInt16(44 + index * 2, true),
  );
  quiet.fill(7);
  voice.fill(8);
  assert({
    given:
      'two synthetic 10ms native-format frames including quiet and signed extrema, followed by caller mutation',
    should:
      'encode independent mono16kHz S16LE WAV bytes without dropping or changing any sample',
    actual: {
      header: new TextDecoder().decode(bytes.subarray(0, 4)),
      wave: new TextDecoder().decode(bytes.subarray(8, 16)),
      length: bytes.length,
      rate: view.getUint32(24, true),
      channels: view.getUint16(22, true),
      bits: view.getUint16(34, true),
      payload: view.getUint32(40, true),
      samples,
    },
    expected: {
      header: 'RIFF',
      wave: 'WAVEfmt ',
      length: 684,
      rate: 16000,
      channels: 1,
      bits: 16,
      payload: 640,
      samples: [
        ...new Int16Array(160),
        0,
        1,
        -1,
        32767,
        -32768,
        ...new Int16Array(155),
      ],
    },
  });
});
test('PCM encoding bounds native frame shape and allocation before producing audio', async () => {
  for (const frames of [
    [],
    new Array<Int16Array>(1),
    [new Int16Array(159)],
    [new Int16Array(161)],
    Array.from({ length: 6001 }, () => new Int16Array(160)),
  ])
    await assertRejects({
      given: 'empty, malformed or over-sixty-second native frames',
      should:
        'refuse invalid encoding rather than create truncated or unbounded audio',
      actual: () => encodePcmWave(frames),
      code: 'VALIDATION',
    });
  assert({
    given: 'exactly sixty seconds of native frames',
    should: 'encode the existing capture maximum without truncation',
    actual: encodePcmWave(
      Array.from({ length: 6000 }, () => new Int16Array(160)),
    ).length,
    expected: 1920044,
  });
});
