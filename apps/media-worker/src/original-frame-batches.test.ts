import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTrackClocks } from '@daisy/media/observation';
import {
  canonicalCaptureEvidenceBody,
  captureStateReply,
} from '@daisy/protocol';
import type { StagedFrame } from './capture-staging';
import { OriginalFrameBatches } from './original-frame-batches/original-frame-batches';
setupRitewayBun();
const id = (letter: string) => letter.repeat(24);
const state = captureStateReply.parse({
  roundId: id('r'),
  sessionId: id('s'),
  version: 2,
  serverNow: new Date(5000).toISOString(),
  status: 'active',
  transcriptAdmissionCutoff: null,
  participants: [
    { roundParticipantId: id('p'), kind: 'human', identity: id('h') },
  ],
  segment: {
    id: id('g'),
    sequence: 0,
    type: 'speech',
    startedAt: new Date(0).toISOString(),
    endedAt: null,
    durationMs: 60000,
    returnedMs: 0,
  },
  intervals: [
    {
      id: id('i'),
      roundParticipantId: id('p'),
      startedAt: new Date(0).toISOString(),
      endedAt: null,
      startedVersion: 1,
      endedVersion: null,
    },
  ],
  nextIntervalId: null,
});
function frames(sequences: readonly number[]): StagedFrame[] {
  const clock = createTrackClocks();
  const calibration = {
    sentAtMs: 0,
    receivedAtMs: 0,
    serverNowMs: 1000,
    precisionMs: 0,
  };
  return sequences.map((sequence) => {
    const observation = {
      sequence,
      beforeMs: 10 + sequence * 10,
      afterMs: 10 + sequence * 10,
    };
    const window = clock.observe(
      { ...observation, trackId: 'native-track' },
      calibration,
    );
    if (!window) throw new Error('Expected original synthetic observation');
    const clockEvidence = clock.evidence('native-track')!;
    // Low energy and a single ten-ms answer are still original evidence, never inferred silence.
    return {
      clockEvidence,
      seat: id('p'),
      segmentId: id('g'),
      frame: {
        pcm: new Int16Array(160).fill(sequence === 0 ? -1 : 0),
        trackId: 'native-track',
        ...window,
      },
    };
  });
}
test('original native batches preserve every sample and original run before any carry heuristic', () => {
  const original = frames(Array.from({ length: 30 }, (_, i) => i));
  const result = OriginalFrameBatches.prepare({
    state,
    workerId: id('w'),
    epoch: 1,
    frames: original,
    evidenceIds: [id('a'), id('b')],
  });
  const bodies = result.kind === 'prepared' ? result.bodies : [];
  assert({
    given:
      'thirty original calibrated native frames including low energy and a ten-ms negative sample',
    should:
      'prepare bounded canonical units with all samples/sequence/history retained, without calling a unit durable or silent',
    actual: {
      kind: result.kind,
      lengths: bodies.map((b) => b.frames.length),
      duration: bodies.map((b) => b.durationMs),
      canonical: bodies.every(
        (b) => canonicalCaptureEvidenceBody(b).kind === 'encoded',
      ),
      first:
        bodies[0]?.frames[0]?.pcmS16le ===
        Buffer.alloc(320, 255).toString('base64'),
      sequence: bodies.flatMap((b) =>
        b.frames.map((f) => f.clock.observation.sequence),
      ),
    },
    expected: {
      kind: 'prepared',
      lengths: [25, 5],
      duration: [250, 50],
      canonical: true,
      first: true,
      sequence: Array.from({ length: 30 }, (_, i) => i),
    },
  });
});
test('a missing native sequence remains two original units without invented bridging', () => {
  const result = OriginalFrameBatches.prepare({
    state,
    workerId: id('w'),
    epoch: 1,
    frames: frames([0, 2]),
    evidenceIds: [id('a'), id('b')],
  });
  assert({
    given:
      'actual native observation sequence0 then2 with a new original run anchor',
    should:
      'retain separate ten-ms units and their original offsets, never manufacture the missing frame',
    actual:
      result.kind === 'prepared'
        ? result.bodies.map((b) => ({
            duration: b.durationMs,
            offset: b.startOffsetMs,
            sequence: b.frames.map((f) => f.clock.observation.sequence),
          }))
        : result,
    expected: [
      { duration: 10, offset: 1000, sequence: [0] },
      { duration: 10, offset: 1020, sequence: [2] },
    ],
  });
});
test('false original clock evidence or unproven history refuses before a downstream carry can consume frames', () => {
  const original = frames([0]);
  const falseClock = {
    ...original[0]!,
    clockEvidence: {
      ...original[0]!.clockEvidence,
      window: { ...original[0]!.clockEvidence.window, nominalStartMs: 9999 },
    },
  };
  const forged = OriginalFrameBatches.prepare({
    state,
    workerId: id('w'),
    epoch: 1,
    frames: [falseClock],
    evidenceIds: [id('a')],
  });
  const notYetRead = OriginalFrameBatches.prepare({
    state: { ...state, serverNow: new Date(1000).toISOString() },
    workerId: id('w'),
    epoch: 1,
    frames: original,
    evidenceIds: [id('a')],
  });
  assert({
    given:
      'an altered native run equation or a history horizon before the frame',
    should:
      'refuse the preparation without discarding or re-authorizing any original source frame',
    actual: [forged.kind, notYetRead.kind, original[0]!.frame.pcm[0]],
    expected: ['refused', 'refused', -1],
  });
});

test('original units retry unknown acknowledgement with stable identity and release only received payloads', async () => {
  const prepared = OriginalFrameBatches.prepare({
    state,
    workerId: id('w'),
    epoch: 1,
    frames: frames([0]),
    evidenceIds: [id('a')],
  });
  if (prepared.kind !== 'prepared')
    throw new Error('Fixture preparation refused');
  const sent: string[] = [];
  let time = 0,
    complete = false;
  await OriginalFrameBatches.preserve(
    {
      bodies: prepared.bodies,
      nowMs: () => time,
      waitUntilMs: async (due) => {
        time = due;
      },
      send: async (body) => {
        sent.push(JSON.stringify(body));
        if (sent.length === 1) throw createAppError('INFRASTRUCTURE');
        if (sent.length === 2)
          return { kind: 'pending', evidenceId: body.evidenceId };
        return {
          kind: 'received',
          evidenceId: body.evidenceId,
          bindingDigest: 'a'.repeat(64),
          payloadAcceptedAt: new Date(1001).toISOString(),
          receipt: {
            evidenceId: body.evidenceId,
            bindingDigest: 'a'.repeat(64),
            authorityId: id('c'),
            receivedAtMs: 1000,
            expiresAtMs: 1000 + 7 * 86400000,
          },
        };
      },
    },
    new AbortController().signal,
  );
  complete = true;
  assert({
    given:
      'a lost payload acknowledgement followed by pending and actual received replies',
    should:
      'retry the same immutable original unit without renewing its identity or releasing on pending',
    actual: {
      complete,
      attempts: sent.length,
      identities: new Set(sent).size,
      time,
    },
    expected: { complete: true, attempts: 3, identities: 1, time: 500 },
  });
});

test('a foreign received payload or key-only reply never releases original frames', async () => {
  const prepared = OriginalFrameBatches.prepare({
    state,
    workerId: id('w'),
    epoch: 1,
    frames: frames([0]),
    evidenceIds: [id('a')],
  });
  if (prepared.kind !== 'prepared')
    throw new Error('Fixture preparation refused');
  const results: boolean[] = [];
  for (const reply of [
    { kind: 'pending', evidenceId: id('z') },
    { kind: 'received', evidenceId: id('a') },
  ]) {
    await OriginalFrameBatches.preserve(
      {
        bodies: prepared.bodies,
        nowMs: () => 0,
        waitUntilMs: async () => {},
        send: async () => reply,
      },
      new AbortController().signal,
    ).then(
      () => results.push(true),
      () => results.push(false),
    );
  }
  assert({
    given: 'foreign-unit pending or a key-only supposed acknowledgement',
    should: 'refuse source release without starting a replacement unit',
    actual: results,
    expected: [false, false],
  });
});
