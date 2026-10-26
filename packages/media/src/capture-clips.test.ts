import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { cutCaptureClips } from './capture-clips';
setupRitewayBun();
const roundId = 'r'.repeat(24),
  roundParticipantId = 'p'.repeat(24),
  segmentId = 's'.repeat(24),
  trackId = 'microphone-track';
const base = Date.parse('2026-10-22T12:00:00.000Z');
const frame = (offset: number, silent = false) => ({
  pcm: new Int16Array(160).fill(silent ? 0 : 1000),
  nominalStartMs: base + offset,
  beforeMs: base + offset - 1,
  afterMs: base + offset + 11,
  trackId,
});
const scope = { roundId, roundParticipantId, serverNowMs: base + 180000 };
const segment = {
  id: segmentId,
  startedAtMs: base,
  endedAtMs: base + 180000,
  durationMs: 180000,
};
const grant = {
  segmentId,
  roundParticipantId,
  startedAtMs: base,
  endedAtMs: base + 180000,
};

test('historical grant changes split or drop full uncertain frames before encoding', () => {
  const result = cutCaptureClips({
    ...scope,
    final: true,
    segments: [segment],
    intervals: [
      { ...grant, endedAtMs: base + 40 },
      { ...grant, startedAtMs: base + 60, endedAtMs: base + 100 },
    ],
    frames: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n) => frame(n)),
  });
  assert({
    given:
      'two floor changes between reads and frames straddling each exclusive boundary',
    should:
      'encode only fully-contained spans and expose every rejected frame as a gap',
    actual: {
      clips: result.clips.map((c) => [
        c.segmentId,
        c.startOffsetMs,
        c.durationMs,
        c.before,
        c.after,
      ]),
      dropped: result.droppedFrames,
    },
    expected: {
      clips: [
        [
          segmentId,
          10,
          20,
          new Date(base + 9).toISOString(),
          new Date(base + 31).toISOString(),
        ],
        [
          segmentId,
          70,
          20,
          new Date(base + 69).toISOString(),
          new Date(base + 91).toISOString(),
        ],
      ],
      dropped: 7,
    },
  });
});

test('bounded clips choose latest observed low-energy frame in final five seconds and preserve PCM WAV bytes', () => {
  const result = cutCaptureClips({
    ...scope,
    final: true,
    segments: [segment],
    intervals: [grant],
    frames: Array.from({ length: 6005 }, (_, i) =>
      frame(10 + i * 10, i === 5699),
    ),
  });
  const first = result.clips[0]!;
  const view = new DataView(
    first.wav.buffer,
    first.wav.byteOffset,
    first.wav.byteLength,
  );
  assert({
    given: 'over sixty seconds with an observed silence at 57 seconds',
    should:
      'cut at that latest silence and encode bounded signed little-endian 16k mono RIFF PCM',
    actual: [
      result.clips.map((c) => [c.startOffsetMs, c.durationMs]),
      new TextDecoder().decode(first.wav.slice(0, 4)),
      view.getUint16(20, true),
      view.getUint16(22, true),
      view.getUint32(24, true),
      view.getUint16(34, true),
      view.getUint32(40, true),
      view.getInt16(44, true),
      first.wav.byteLength,
    ],
    expected: [
      [
        [10, 57000],
        [57010, 3050],
      ],
      'RIFF',
      1,
      1,
      16000,
      16,
      57000 * 32,
      1000,
      44 + 57000 * 32,
    ],
  });
});

test('segment changes and missing eligibility never lend one segment to another', () => {
  const next = 'n'.repeat(24);
  const input = {
    ...scope,
    final: true,
    segments: [
      { ...segment, endedAtMs: base + 40 },
      { ...segment, id: next, startedAtMs: base + 40, endedAtMs: base + 100 },
    ],
    intervals: [
      { ...grant, endedAtMs: base + 40 },
      {
        ...grant,
        segmentId: next,
        startedAtMs: base + 40,
        endedAtMs: base + 100,
      },
    ],
    frames: [frame(10), frame(20), frame(30), frame(40), frame(50)],
  };
  const result = cutCaptureClips(input);
  const same = cutCaptureClips(input);
  assert({
    given: 'adjacent actual segments with uncertainty across their boundary',
    should:
      'split labels, drop boundary frames and derive stable scope/offset clip identity',
    actual: [
      result.clips.map((c) => [c.segmentId, c.startOffsetMs, c.durationMs]),
      result.droppedFrames,
      result.clips[0]!.clipKey === same.clips[0]!.clipKey,
      cutCaptureClips({ ...input, intervals: [] }).clips.length,
    ],
    expected: [
      [
        [segmentId, 10, 20],
        [next, 10, 10],
      ],
      2,
      true,
      0,
    ],
  });
});

test('invalid PCM and unbounded batches fail before retaining or encoding audio', async () => {
  for (const frames of [
    [{ ...frame(10), pcm: new Int16Array(159) }],
    Array.from({ length: 12001 }, () => frame(10)),
  ]) {
    await assertRejects({
      given: 'malformed PCM or more than the two-minute hard batch bound',
      should: 'refuse the batch',
      actual: async () =>
        cutCaptureClips({
          ...scope,
          final: true,
          segments: [segment],
          intervals: [grant],
          frames,
        }),
      code: 'VALIDATION',
    });
  }
});

test('future and repeated nominal frames never acquire fresh capture or duplicated content', () => {
  const result = cutCaptureClips({
    ...scope,
    final: true,
    segments: [segment],
    intervals: [grant],
    frames: [frame(10), frame(10), frame(20), frame(30)],
    serverNowMs: base + 40,
  });
  assert({
    given:
      'a duplicate native nominal frame and an upper uncertainty bound beyond fresh database time',
    should: 'drop both without duplicate content or future STT input',
    actual: [
      result.clips.map((c) => [c.startOffsetMs, c.durationMs]),
      result.droppedFrames,
    ],
    expected: [
      [
        [10, 10],
        [20, 10],
      ],
      2,
    ],
  });
});

/** Feeds 250 ms batches as the worker does, carrying uncut frames, final at segment end. */
const cutInBatches = (silentAt: (index: number) => boolean, count: number) => {
  const clips: ReturnType<typeof cutCaptureClips>['clips'] = [];
  let carry: ReturnType<typeof cutCaptureClips>['carry'] = null;
  const perBatch: number[] = [];
  for (let start = 0; start < count; start += 25) {
    const last = start + 25 >= count;
    const result = cutCaptureClips({
      ...scope,
      segments: [segment],
      intervals: [grant],
      frames: Array.from({ length: Math.min(25, count - start) }, (_, i) =>
        frame(10 + (start + i) * 10, silentAt(start + i)),
      ),
      carry,
      final: last,
    });
    carry = result.carry;
    perBatch.push(result.clips.length);
    clips.push(...result.clips);
  }
  return {
    clips: clips.map((c) => [c.startOffsetMs, c.durationMs]),
    beforeFinal: perBatch.slice(0, -1).reduce((sum, n) => sum + n, 0),
    carry,
  };
};

test('continuous speech arriving in 250 ms batches is one clip, flushed at segment end', () => {
  assert({
    given: 'two seconds of continuous speech in eight 250 ms batches',
    should:
      'carry the uncut frames between batches and emit one clip only at the final flush (VIDEO-4.1-r7)',
    actual: cutInBatches(() => false, 200),
    expected: { clips: [[10, 2000]], beforeFinal: 0, carry: null },
  });
});

test('a pause after speech cuts the clip; silence alone never does', () => {
  // 0.7 s silence, 1 s speech, 0.6 s silence, 1 s speech.
  const silent = (i: number) => i < 70 || (i >= 170 && i < 230);
  assert({
    given:
      'leading silence, speech, a 600 ms pause and more speech, in 250 ms batches',
    should:
      'cut once the pause reaches 500 ms, keeping the leading silence with the first words, and flush the rest at the end',
    actual: cutInBatches(silent, 330).clips,
    expected: [
      [10, 2200],
      [2210, 1100],
    ],
  });
});

test('sixty seconds of unbroken speech across batches cuts at the hard bound', () => {
  assert({
    given: 'sixty-one seconds of speech with no low-energy frame, in batches',
    should: 'cut at sixty seconds and flush the remaining second at the end',
    actual: cutInBatches(() => false, 6100).clips,
    expected: [
      [10, 60000],
      [60010, 1000],
    ],
  });
});
