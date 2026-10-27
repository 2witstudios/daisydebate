import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { CaptureClient } from './capture-history';
import {
  createCaptureSessionFixture,
  captureRoundId,
} from './capture-session.test-support';
setupRitewayBun();

test('a failure is reported where it began, not where the session it stopped was waiting', async () => {
  assert({
    given:
      'the clip consumer failing while the batch loop has a history read in flight',
    should:
      'report the transcription stage, not the cancelled read it aborted (ISSUE-571 review)',
    actual: await createCaptureSessionFixture({ consumerFails: 20, readMs: 50 })
      .done,
    expected: { cause: 'transcription', errorCode: 'INFRASTRUCTURE' },
  });
  assert({
    given: 'that failure, then a shutdown step that throws',
    should: 'still report the first failure',
    actual: await createCaptureSessionFixture({
      consumerFails: 20,
      readMs: 50,
      closeThrows: true,
    }).done,
    expected: { cause: 'transcription', errorCode: 'INFRASTRUCTURE' },
  });
});

test('a LiveKit room that drops after connect is a connect failure, unless the Round closed', async () => {
  assert({
    given: 'the LiveKit room dropping while the Round still needs capture',
    should: 'report the connect stage rather than end cleanly',
    actual: await createCaptureSessionFixture({ drop: 10 }).done,
    expected: { cause: 'connect', errorCode: 'INFRASTRUCTURE' },
  });
  assert({
    given:
      'the LiveKit room dropping because the server closed the capture for good',
    should: 'finish the session, as a terminal Round does',
    actual: await createCaptureSessionFixture({ drop: 10, closedOnDrop: true })
      .done,
    expected: 'closed for good',
  });
  assert({
    given:
      'an identity update refused because LiveKit already closed the connection, before its close resolves',
    should: 'report the drop as connect, not as a refresh conflict',
    actual: await createCaptureSessionFixture({ drop: 10, closingFirst: true })
      .done,
    expected: { cause: 'connect', errorCode: 'INFRASTRUCTURE' },
  });
});

test('an ended stream whose staged frame no batch took yet is never sealed in the loop', async () => {
  const ids = (label: string) => label.repeat(24);
  const [segment, next, seat] = [ids('g'), ids('h'), ids('p')];
  const calibration = {
    sentAtMs: 0,
    receivedAtMs: 1,
    serverNowMs: 10000,
    precisionMs: 1,
  };
  const snapshot = (
    segmentId: string,
    serverNow: string,
  ): Awaited<ReturnType<CaptureClient['read']>> => ({
    calibration,
    state: {
      roundId: captureRoundId,
      sessionId: ids('s'),
      version: 1,
      serverNow,
      status: 'active',
      transcriptAdmissionCutoff: null,
      participants: [
        { roundParticipantId: seat, identity: ids('i'), kind: 'human' },
      ],
      segment: {
        id: segmentId,
        sequence: segmentId === segment ? 0 : 1,
        type: 'speech',
        startedAt: new Date(segmentId === segment ? 9000 : 10050).toISOString(),
        endedAt: null,
        durationMs: 60000,
      },
      intervals:
        segmentId === segment
          ? [
              {
                id: ids('a'),
                roundParticipantId: seat,
                startedAt: new Date(10000).toISOString(),
                endedAt: null,
                startedVersion: 1,
                endedVersion: null,
              },
            ]
          : [],
      nextIntervalId: null,
    },
  });
  // The stale history page a segment-scoped read answers with: its serverNow
  // predates the frame, so every batch holds the frame back for the next one.
  const stale = snapshot(segment, new Date(10000).toISOString());
  // The loop's own reads: the segment still live at setup, then superseded
  // with three settle windows passing, then the capture closed for good.
  const loopAnswers: (Awaited<ReturnType<CaptureClient['read']>> | 'closed')[] =
    [
      snapshot(segment, new Date(10001).toISOString()),
      snapshot(next, new Date(10050).toISOString()),
      snapshot(next, new Date(11500).toISOString()),
      snapshot(next, new Date(12250).toISOString()),
      'closed',
    ];
  const session = createCaptureSessionFixture({
    read: (request) =>
      request.segmentId === segment ? stale : loopAnswers.shift()!,
    onSubscribe: (emit) => {
      emit({
        identity: ids('i'),
        trackId: 'track-a',
        sequence: 0,
        beforeMs: 20,
        afterMs: 20.1,
        pcm: new Int16Array(160).fill(7),
      });
    },
  });
  assert({
    given:
      "a stream whose segment the history superseded while the stream's frame sits staged, held back by every batch's stale segment read",
    should:
      'leave the stream unsealed until the loop ends, since staging still holds its frame (ISSUE-580)',
    actual: {
      ended: await session.done,
      seals: session.seals(),
    },
    expected: { ended: 'closed for good', seals: [8] },
  });
});

test('a slow refresh retains the live subscription and retries fresh history', async () => {
  const f = createCaptureSessionFixture({
    stallRefresh: true,
    closeAfterRecovery: true,
  });
  const ended = await f.done;
  assert({
    given: 'a live capture whose first refresh exceeds the history deadline',
    should:
      'retry within the same session and stop only at the later authoritative closure',
    actual: { ended, reads: f.reads() },
    expected: { ended: 'closed for good', reads: 4 },
  });
});
