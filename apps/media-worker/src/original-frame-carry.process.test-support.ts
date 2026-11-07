import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createMediaWorkerClient } from '@daisy/media/worker';
import {
  canonicalCaptureEvidenceBody,
  captureStateReply,
} from '@daisy/protocol';
import { validateCaptureBatch, type ClipCarries } from './capture-batch';
import { OriginalFrameBatches } from './original-frame-batches/original-frame-batches';

/** Synthetic original callback samples over real signed ingress; never a played-media claim. */
async function main() {
  const raw = JSON.parse(await Bun.stdin.text()) as unknown;
  const encoded = canonicalCaptureEvidenceBody(raw);
  if (encoded.kind !== 'encoded') throw new Error('Invalid process fixture');
  const body = encoded.body;
  const secret = process.env.EVIDENCE_PROCESS_TEST_SECRET;
  const url = process.env.EVIDENCE_PROCESS_TEST_URL;
  if (!secret || !url || new URL(url).hostname !== '127.0.0.1')
    throw new Error('Local test resource required');
  const client = createMediaWorkerClient({
    scope: {
      roundId: body.roundId,
      sessionId: body.sessionId,
      workerId: body.workerId,
    },
    authentication: createMediaWorkerAuthentication({ secret, now: Date.now }),
    url,
    fetch,
    nowMs: performance.now,
    deadlineSignal: () => AbortSignal.timeout(5000),
    unavailableRetryMs: [],
  });
  const state = captureStateReply.parse({
    roundId: body.roundId,
    sessionId: body.sessionId,
    version: body.historyVersion,
    serverNow: body.historyReadAt,
    status: 'completed',
    transcriptAdmissionCutoff: null,
    participants: [
      {
        roundParticipantId: body.roundParticipantId,
        kind: 'human',
        identity: body.roundParticipantId,
      },
    ],
    segment: {
      id: body.segmentId,
      sequence: 0,
      type: 'speech',
      startedAt: new Date(body.segmentStartedAtMs).toISOString(),
      endedAt: body.historyReadAt,
      durationMs: 1000,
      returnedMs: 0,
    },
    intervals: [
      {
        id: body.intervalId,
        roundParticipantId: body.roundParticipantId,
        startedAt: new Date(body.segmentStartedAtMs).toISOString(),
        endedAt: body.historyReadAt,
        startedVersion: 1,
        endedVersion: body.historyVersion,
      },
    ],
    nextIntervalId: null,
  });
  const frames = body.frames.map((frame) => {
    const bytes = Buffer.from(frame.pcmS16le, 'base64');
    const pcm = Int16Array.from({ length: 160 }, (_, index) =>
      bytes.readInt16LE(index * 2),
    );
    return {
      clockEvidence: frame.clock,
      seat: body.roundParticipantId,
      segmentId: body.segmentId,
      frame: {
        pcm,
        trackId: body.trackId,
        nominalStartMs: frame.clock.window.nominalStartMs,
        beforeMs: Math.floor(frame.clock.window.beforeMs),
        afterMs: Math.ceil(frame.clock.window.afterMs),
      },
    };
  });
  const carries: ClipCarries = new Map();
  let wavs = 0;
  await validateCaptureBatch({
    frames,
    current: {
      state,
      calibration: {
        ...body.frames[0]!.clock.anchor.calibration,
        precisionMs: body.frames[0]!.clock.anchor.calibration.precisionMs ?? 0,
      },
    },
    client,
    roundId: body.roundId,
    epoch: body.epoch,
    signal: new AbortController().signal,
    nowMs: performance.now,
    waitUntilMs: async (due) => {
      await Bun.sleep(Math.max(0, due - performance.now()));
    },
    dropped: (count) => {
      if (count) throw new Error('Unexpected sample discard');
    },
    held: (frames) => {
      if (frames.length) throw new Error('Unexpected held frame');
    },
    straddled: () => {},
    clip: () => {
      wavs++;
    },
    carries,
    preserveFrames: async (original, source, signal) => {
      const prepared = OriginalFrameBatches.prepare({
        state: original,
        workerId: body.workerId,
        epoch: body.epoch,
        frames: source,
        evidenceIds: [body.evidenceId],
      });
      if (
        prepared.kind !== 'prepared' ||
        JSON.stringify(prepared.bodies[0]) !== encoded.json
      )
        throw new Error('Original callback changed');
      await OriginalFrameBatches.preserve(
        {
          bodies: prepared.bodies,
          send: client.preserve,
          nowMs: performance.now,
          waitUntilMs: async (due) => {
            await Bun.sleep(Math.max(0, due - performance.now()));
          },
        },
        signal,
      );
    },
  });
  process.stdout.write(
    JSON.stringify({
      kind: 'durable-carry',
      frames: [...carries.values()].reduce(
        (sum, carry) => sum + carry.frames.length,
        0,
      ),
      wavs,
    }) + '\n',
  );
  await Bun.sleep(60000);
}
if (import.meta.main) await main();
