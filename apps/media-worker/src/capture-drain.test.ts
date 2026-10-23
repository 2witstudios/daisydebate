import { assert, setupRitewayBun, test } from 'riteway/bun';
import { cutCaptureClips } from '@daisy/media/clips';
import type { ClipCarries } from './capture-batch';
import { consumeCaptureClips, type QueuedClip } from './capture-consumer';
import { closeCaptureSession } from './capture-drain';
import { recordingCaptureClient } from './capture-client.test-support';

setupRitewayBun();

const base = Date.UTC(2026, 9, 22, 12, 0, 0);
const at = (ms: number) => new Date(base + ms).toISOString();
const roundId = 'r'.repeat(24),
  seat = 's'.repeat(24),
  segmentId = 'g'.repeat(24);
const state = {
  version: 1,
  serverNow: at(9000),
  nextIntervalId: null,
  participants: [],
  segment: {
    id: segmentId,
    startedAt: at(0),
    endedAt: null,
    durationMs: 60_000,
  },
  intervals: [{ roundParticipantId: seat, startedAt: at(0), endedAt: null }],
};
/** Two seconds of one seat's speech, cut but not yet ended: its open carry. */
function openSpeechCarry(): ClipCarries {
  const { clips, carry } = cutCaptureClips({
    roundId,
    roundParticipantId: seat,
    serverNowMs: base + 9000,
    segments: [
      { id: segmentId, startedAtMs: base, endedAtMs: null, durationMs: 60_000 },
    ],
    intervals: [
      {
        segmentId,
        roundParticipantId: seat,
        startedAtMs: base,
        endedAtMs: null,
      },
    ],
    frames: Array.from({ length: 200 }, (_, i) => ({
      pcm: new Int16Array(160).fill(1000),
      trackId: 'track',
      nominalStartMs: base + 1000 + i * 10,
      beforeMs: base + 999 + i * 10,
      afterMs: base + 1011 + i * 10,
    })),
    final: false,
  });
  if (clips.length || !carry) throw new Error('Expected one open carry');
  return new Map([[JSON.stringify([segmentId, seat]), carry]]);
}
/**
 * Closes a session over the real consumer: the batch loop has stopped and
 * the consumer is still running; the close drains it or not, then seals.
 */
async function close(
  graceful: boolean,
  transcribe: (request: { signal: AbortSignal }) => Promise<{ text: string }>,
) {
  let now = 0;
  const calls: string[] = [];
  const queue: QueuedClip[] = [];
  let inFlight = 0,
    committed = 0,
    dropped = 0;
  const halt = new AbortController();
  const client = recordingCaptureClient(state, calls);
  const waitUntilMs = async (due: number, signal: AbortSignal) => {
    now = Math.max(now, due);
    await Bun.sleep(0);
    signal.throwIfAborted();
  };
  const consuming = consumeCaptureClips({
    client,
    epoch: 1,
    voice: { transcribe } as never,
    sttModel: 'stt',
    signal: halt.signal,
    nowMs: () => now,
    waitUntilMs,
    take: () => queue.shift(),
    straddles: () => [],
    dropped: (n) => {
      dropped += n;
    },
    transcribed: () => calls.push('transcribed'),
    committed: () => {
      committed++;
    },
    settled: () => {
      inFlight--;
    },
  }).catch(() => undefined);
  const carries = openSpeechCarry();
  const sealed = await closeCaptureSession({
    graceful,
    carries,
    roundId,
    enqueue: (clip) => {
      inFlight++;
      queue.push({ ...clip, bytes: clip.wav.byteLength });
    },
    inFlight: () => inFlight,
    halt: () => halt.abort(),
    consuming,
    discardQueued: () => {
      const left = queue.splice(0);
      return left.reduce((sum, clip) => sum + clip.durationMs / 10, 0);
    },
    dropped: (n) => {
      dropped += n;
    },
    seal: async () => {
      // The fallback seal: each stream with the chunks this epoch committed.
      calls.push(`seal:${committed}`);
      return 1;
    },
    nowMs: () => now,
    waitUntilMs,
  });
  return { sealed, calls, carried: carries.size, dropped };
}

test('an open speech carry survives a graceful stop as a transcribed clip the final seal counts', async () => {
  assert({
    given:
      'two seconds of speech still in its carry when the worker receives SIGTERM (a deploy or restart)',
    should:
      'flush it as a final clip, transcribe, append and observe it, then seal counting its chunk (VIDEO-4.1-r12)',
    actual: await close(true, async () => ({ text: 'the evidence' })),
    expected: {
      sealed: 1,
      calls: ['transcribed', 'append', 'observe', 'seal:1'],
      carried: 0,
      dropped: 0,
    },
  });
});

test('an abrupt stop drops the open carry and still seals, honestly partial', async () => {
  assert({
    given:
      'the same open carry when the capture closed or the lease was lost (not a graceful stop)',
    should:
      'count its frames dropped, transcribe nothing, and still run the fallback seal with no chunk for it (VIDEO-4.1-r12, DEC-208)',
    actual: await close(false, async () => ({ text: 'never' })),
    expected: { sealed: 1, calls: ['seal:0'], carried: 0, dropped: 200 },
  });
});

test('a drain that outlasts its budget stops at the deadline and seals without the clip', async () => {
  assert({
    given: 'a final clip whose transcription never answers within the budget',
    should:
      'stop draining at the deadline, then seal with no chunk for it, so its stream seals partial (VIDEO-4.1-r12, DEC-208)',
    // Like the adapter, an unanswered call ends only with the session's cancellation.
    actual: await close(
      true,
      ({ signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        ),
    ),
    expected: { sealed: 1, calls: ['seal:0'], carried: 0, dropped: 0 },
  });
});
