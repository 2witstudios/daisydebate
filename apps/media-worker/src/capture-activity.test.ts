import { assert, setupRitewayBun, test } from 'riteway/bun';
import { activityBatches } from './capture-activity';
import type { StagedFrame } from './capture-staging';
setupRitewayBun();
const staged = (seat: string, sequence: number): StagedFrame => ({
  seat,
  segmentId: 'g'.repeat(24),
  observedAtMs: sequence * 10 + 5,
  original: { sequence, beforeMs: sequence * 10, afterMs: sequence * 10 + 5 },
  frame: {
    pcm: new Int16Array(160).fill(sequence),
    trackId: `${seat[0]}-track`,
    nominalStartMs: 1000 + sequence * 10,
    beforeMs: 999 + sequence * 10,
    afterMs: 1011 + sequence * 10,
  },
});
test('activity batches relay the freshest original frames per seat with calibrated windows', () => {
  const host = 'h'.repeat(24),
    guest = 'q'.repeat(24);
  const frames = [
    ...Array.from({ length: 22 }, (_, i) => staged(host, i)),
    staged(guest, 40),
  ];
  const batches = activityBatches(frames);
  const hostBatch = batches.find((b) => b.roundParticipantId === host)!;
  assert({
    given: 'more staged frames for one seat than a relay batch holds',
    should:
      'send one batch per seat keeping only the freshest twenty in callback order',
    actual: {
      seats: batches.map((b) => b.roundParticipantId),
      sequences: hostBatch.frames.map((f) => f.sequence),
    },
    expected: {
      seats: [host, guest],
      sequences: Array.from({ length: 20 }, (_, i) => i + 2),
    },
  });
  assert({
    given: 'one staged guest frame',
    should:
      'carry its original native brackets and plain PCM with the calibrated server window',
    actual: batches.find((b) => b.roundParticipantId === guest)!.frames,
    expected: [
      {
        trackId: 'q-track',
        sequence: 40,
        pcm: Array<number>(160).fill(40),
        beforeMs: 400,
        afterMs: 405,
        serverWindow: {
          before: new Date(1399).toISOString(),
          after: new Date(1411).toISOString(),
        },
      },
    ],
  });
  assert({
    given: 'no staged frames',
    should: 'relay nothing',
    actual: activityBatches([]),
    expected: [],
  });
});
