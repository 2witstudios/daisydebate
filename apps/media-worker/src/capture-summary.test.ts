import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { CaptureClient } from './capture-history';
import { readCaptureSummary } from './capture-summary';
import {
  createCaptureSessionFixture,
  captureRoundId,
} from './capture-session.test-support';

setupRitewayBun();

test('a summary is one count and nothing else', () => {
  assert({
    given: 'a count, and messages that are anything else',
    should: 'read only the count',
    actual: [
      { silentClips: 3 },
      { silentClips: -1 },
      { silentClips: 1.5 },
      { silentClips: 3, text: 'words' },
      'silentClips',
      null,
    ].map(readCaptureSummary),
    expected: [{ silentClips: 3 }, null, null, null, null, null],
  });
});

test('a child with its output closed can still report to the worker', async () => {
  const heard = Promise.withResolvers<unknown>();
  const child = Bun.spawn(
    [process.execPath, '-e', 'process.send({ silentClips: 3 })'],
    {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      ipc: (message) => heard.resolve(message),
    },
  );
  const message = await heard.promise;
  await child.exited;
  assert({
    given: 'a process spawned as the worker spawns capture',
    should: 'deliver its summary',
    actual: readCaptureSummary(message),
    expected: { silentClips: 3 },
  });
});

test('a session counts the silent clips it cut', async () => {
  const seat = 'p'.repeat(24);
  const history = (
    serverNow: number,
  ): Awaited<ReturnType<CaptureClient['read']>> => ({
    calibration: {
      sentAtMs: 0,
      receivedAtMs: 1,
      serverNowMs: 10000,
      precisionMs: 1,
    },
    state: {
      roundId: captureRoundId,
      sessionId: 's'.repeat(24),
      version: 1,
      serverNow: new Date(serverNow).toISOString(),
      status: 'active',
      transcriptAdmissionCutoff: null,
      participants: [
        { roundParticipantId: seat, identity: 'i'.repeat(24), kind: 'human' },
      ],
      segment: {
        id: 'g'.repeat(24),
        sequence: 0,
        type: 'speech',
        startedAt: new Date(9000).toISOString(),
        endedAt: null,
        durationMs: 60000,
      },
      intervals: [
        {
          id: 'a'.repeat(24),
          roundParticipantId: seat,
          startedAt: new Date(9000).toISOString(),
          endedAt: null,
          startedVersion: 1,
          endedVersion: null,
        },
      ],
      nextIntervalId: null,
    },
  });
  const answers: (Awaited<ReturnType<CaptureClient['read']>> | 'closed')[] = [
    history(10001),
    history(10100),
    history(10200),
    history(11500),
    'closed',
  ];
  const session = createCaptureSessionFixture({
    read: () => answers.shift() ?? 'closed',
    onSubscribe: (emit) =>
      emit({
        identity: 'i'.repeat(24),
        trackId: 'track-a',
        sequence: 0,
        beforeMs: 20,
        afterMs: 20.1,
        pcm: new Int16Array(160),
      }),
  });
  assert({
    given: 'one frame of silence, then the capture closing',
    should: 'report one silent clip',
    actual: [await session.done, session.silentClips()],
    expected: ['closed for good', 1],
  });
});
