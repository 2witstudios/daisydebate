import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPeerAudioTap, type PeerAudioFrame } from './peer-audio';
setupRitewayBun();

const frame = (sequence: number): PeerAudioFrame => ({
  identity: 'i',
  trackId: 'TR_a',
  sequence,
  pcm: new Int16Array(160),
  beforeMs: sequence * 10,
  afterMs: sequence * 10 + 10,
});

test('every reader sees each frame, a failing reader harms no one, and a stopped reader sees no more', () => {
  const tap = createPeerAudioTap();
  const seen: number[] = [];
  tap.read(() => {
    throw new Error('reader fault');
  });
  const stop = tap.read((f) => seen.push(f.sequence));
  tap.publish(frame(1));
  stop();
  tap.publish(frame(2));
  assert({
    given: 'a failing reader and a reader that stops after one frame',
    should:
      'deliver the first frame to the healthy reader and nothing after it stops',
    actual: seen,
    expected: [1],
  });
});
