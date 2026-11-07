import { assert, setupRitewayBun, test } from 'riteway/bun';
import { canonicalCaptureEvidenceBody } from './capture-evidence-body';
setupRitewayBun();
const at = 1_800_000_000_100;
const iso = (time: number) => new Date(time).toISOString();
const body = () => ({
  version: 1,
  evidenceId: 'e'.repeat(24),
  roundId: 'r'.repeat(24),
  sessionId: 's'.repeat(24),
  workerId: 'w'.repeat(24),
  epoch: 1,
  segmentId: 'g'.repeat(24),
  roundParticipantId: 'p'.repeat(24),
  trackId: 'native-track',
  intervalId: 'i'.repeat(24),
  historyVersion: 2,
  historyReadAt: iso(at + 20),
  segmentStartedAtMs: at - 100,
  startOffsetMs: 100,
  durationMs: 10,
  before: iso(at - 1),
  after: iso(at + 11),
  frames: [
    {
      pcmS16le: Buffer.alloc(320).toString('base64'),
      clock: {
        observation: { sequence: 0, beforeMs: 10, afterMs: 10 },
        anchor: {
          calibration: {
            sentAtMs: 0,
            receivedAtMs: 0,
            serverNowMs: at,
            precisionMs: 0,
          },
          observation: { sequence: 0, beforeMs: 10, afterMs: 10 },
          previous: null,
        },
        previous: null,
        window: {
          nominalStartMs: at,
          beforeMs: at - 0.001,
          afterMs: at + 10.001,
        },
      },
    },
  ],
});
test('full original capture bodies have one canonical encoding independent of object property order', () => {
  const original = body();
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  const first = canonicalCaptureEvidenceBody(original);
  const second = canonicalCaptureEvidenceBody(reordered);
  assert({
    given: 'the same original frames/provenance with reordered JSON properties',
    should:
      'produce identical canonical bytes suitable for a server-derived full-body digest',
    actual:
      first.kind === 'encoded' && second.kind === 'encoded'
        ? second.json
        : [first.kind, second.kind],
    expected: first.kind === 'encoded' ? first.json : ['encoded'],
  });
});
test('canonical evidence refuses malformed PCM/provenance, header mismatch and caller digest substitution', () => {
  const original = body();
  const invalid = [
    { ...original, frames: [{ ...original.frames[0], pcmS16le: 'AA==' }] },
    { ...original, before: iso(at) },
    { ...original, historyReadAt: iso(at) },
    { ...original, durationMs: 20 },
    { ...original, bodyDigest: 'b'.repeat(64) },
  ];
  assert({
    given:
      'truncated PCM, mismatched bounds/time, or a supplied digest in place of full-body validation',
    should: 'refuse every envelope before admission or custody',
    actual: invalid.map((input) => canonicalCaptureEvidenceBody(input).kind),
    expected: invalid.map(() => 'invalid'),
  });
});
test('changing source PCM or original history changes the canonical body', () => {
  const original = body();
  const first = canonicalCaptureEvidenceBody(original);
  const pcm = canonicalCaptureEvidenceBody({
    ...original,
    frames: [
      {
        ...original.frames[0],
        pcmS16le: Buffer.alloc(320, 1).toString('base64'),
      },
    ],
  });
  const history = canonicalCaptureEvidenceBody({
    ...original,
    intervalId: 'j'.repeat(24),
  });
  assert({
    given:
      'another PCM body or another original granting interval under the same evidence ID',
    should: 'change the bytes covered by the server-derived digest',
    actual: [pcm, history].map(
      (changed) =>
        first.kind === 'encoded' &&
        changed.kind === 'encoded' &&
        !Buffer.from(first.json).equals(Buffer.from(changed.json)),
    ),
    expected: [true, true],
  });
});

test('canonical evidence accounts for actual UTF-8 bytes', () => {
  const encoded = canonicalCaptureEvidenceBody({
    ...body(),
    trackId: 'native-🎤',
  });
  assert({
    given: 'non-ASCII original track metadata',
    should: 'reserve encoded bytes rather than UTF-16 character count',
    actual: encoded.kind === 'encoded' ? encoded.byteLength : encoded.kind,
    expected:
      encoded.kind === 'encoded' ? Buffer.byteLength(encoded.json, 'utf8') : 0,
  });
});

test('one preserved batch cannot bridge an absent PCM frame inside its original run', () => {
  const original = body();
  const first = original.frames[0]!;
  const withSecond = (step: number) => ({
    ...original,
    durationMs: step * 10 + 10,
    after: iso(at + step * 10 + 11),
    historyReadAt: iso(at + step * 10 + 20),
    frames: [
      first,
      {
        ...first,
        clock: {
          ...first.clock,
          observation: {
            sequence: step,
            beforeMs: 10 + step * 10,
            afterMs: 10 + step * 10,
          },
          previous: {
            sequence: step - 1,
            nominalStartMs: at + (step - 1) * 10,
          },
          window: {
            nominalStartMs: at + step * 10,
            beforeMs: at + step * 10 - 0.001,
            afterMs: at + step * 10 + 10.001,
          },
        },
      },
    ],
  });
  assert({
    given:
      'two frames under one anchor, either adjacent or missing an intervening PCM unit',
    should:
      'encode adjacent original units and refuse span-based invented preservation across the missing frame',
    actual: [1, 2].map(
      (step) => canonicalCaptureEvidenceBody(withSecond(step)).kind,
    ),
    expected: ['encoded', 'invalid'],
  });
});
