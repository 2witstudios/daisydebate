import type { RecordingMedia } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRecordingCapturePort } from './capture-port';
import { fakeRecordingStore } from './fake-store.test-support';

setupRitewayBun();

const startedAt = '2026-11-02T10:00:00.000Z';
const endedAt = '2026-11-02T10:01:00.000Z';
const media: Omit<RecordingMedia, 'speeches'> = {
  playlistKey: 'recordings/rec-1/hls/master.m3u8',
  downloadKey: 'recordings/rec-1/video.mp4',
  durationMs: 60_000,
  byteSize: 10,
  verifiedAt: endedAt,
  gaps: [],
};
const round = {
  roundId: 'round',
  competitionType: 'ranked',
  hostActorId: 'host',
  hostOptedIn: false,
  hostHoldsRecording: false,
} as const;

const setup = () => {
  const { store, rows } = fakeRecordingStore();
  let next = 0;
  const port = createRecordingCapturePort({
    store,
    nextId: () => `rec-${++next}`,
    inputs: {
      readFloorIntervals: async () => [
        {
          roundParticipantId: 'aff',
          startedAtMs: Date.parse(startedAt) + 1000,
          endedAtMs: Date.parse(startedAt) + 5000,
        },
      ],
    },
  });
  return { port, rows };
};

test('a request is idempotent per Round and needs eligibility', async () => {
  const { port, rows } = setup();
  const first = await port.request(round);
  const second = await port.request(round);
  assert({
    given: 'the same Round requested twice',
    should: 'keep one stable identity',
    actual: [first?.id, second?.id, rows.size],
    expected: ['rec-1', 'rec-1', 1],
  });
  assert({
    given: 'a casual Round with no opt-in',
    should: 'create nothing',
    actual: await port.request({
      ...round,
      roundId: 'other',
      competitionType: 'casual',
    }),
    expected: null,
  });
});

test('verified media carries the speech timeline in video time', async () => {
  const { port, rows } = setup();
  await port.request(round);
  await port.captureStarted('rec-1', { egressId: 'EG', at: startedAt });
  await port.captureEnded('rec-1', {
    egressId: 'EG',
    sourceKey: 'recordings/rec-1/source.mp4',
    at: endedAt,
  });
  assert({
    given: 'verified media',
    should: 'move to ready',
    actual: await port.mediaVerified('rec-1', media),
    expected: 'moved',
  });
  const { lifecycle } = rows.get('rec-1')!;
  assert({
    given: 'a floor turn one second into the capture',
    should: 'store it in video time',
    actual: lifecycle.status === 'ready' ? lifecycle.media.speeches : null,
    expected: [{ roundParticipantId: 'aff', startMs: 1000, endMs: 5000 }],
  });
  assert({
    given: 'the report retried after a crash',
    should: 'change nothing',
    actual: await port.mediaVerified('rec-1', media),
    expected: 'unchanged',
  });
  assert({
    given: 'an ambiguous failure after readiness',
    should: 'refuse and stay ready',
    actual: [
      await port.failed('rec-1', { reason: 'capture_failed', at: endedAt }),
      rows.get('rec-1')!.lifecycle.status,
    ],
    expected: ['refused', 'ready'],
  });
});
