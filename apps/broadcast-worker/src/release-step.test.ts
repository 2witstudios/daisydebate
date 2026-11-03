import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { releaseStep, type ReleasePorts } from './release-step';

setupRitewayBun();

const start = Date.parse('2026-11-02T00:00:00.000Z');
const playlist = (n: number) =>
  '#EXTM3U\n' +
  Array.from(
    { length: n },
    (_, i) =>
      `#EXT-X-PROGRAM-DATE-TIME:${new Date(start + i * 4000).toISOString()}\n#EXTINF:4.000,\ns_${i}.ts\n`,
  ).join('');

const world = (over: Partial<ReleasePorts> = {}) => {
  const log: string[] = [];
  const ports: ReleasePorts = {
    readHoldPlaylist: async () => playlist(3),
    encode: async (name) => {
      log.push(`encode ${name}`);
      return ['720', '480', '240'].map((rendition) => ({
        rendition,
        file: `/tmp/${rendition}`,
      }));
    },
    publishSegment: async (seq, rendition) => {
      log.push(`segment ${seq}/${rendition}`);
    },
    publishManifest: async (key) => {
      log.push(`manifest ${key}`);
    },
    recordReleased: async (seq, end) => {
      log.push(`record ${seq} ${end - start}`);
      return true;
    },
    ...over,
  };
  return { ports, log };
};
const input = (over = {}) => ({
  policy: { kind: 'delay', seconds: 60 } as const,
  nextSegment: 0,
  nowMs: start + 64_000,
  roundEndedAtMs: null,
  ...over,
});

describe('releaseStep', () => {
  test('holds a segment that is not due, touching nothing', async () => {
    const { ports, log } = world();
    assert({
      given: 'the first segment 1 ms before its due time',
      should: 'report waiting and publish nothing',
      actual: [
        (await releaseStep(input({ nowMs: start + 63_999 }), ports)).kind,
        log,
      ],
      expected: ['waiting', []],
    });
  });
  test('reports nothing held when the playlist has not reached the cursor', async () => {
    const { ports } = world();
    assert({
      given: 'a cursor past the last held segment',
      should: 'report waiting',
      actual: (await releaseStep(input({ nextSegment: 3 }), ports)).kind,
      expected: 'waiting',
    });
  });
  test('publishes media, then manifests, and only then moves the watermark', async () => {
    const { ports, log } = world();
    const result = await releaseStep(input(), ports);
    assert({
      given: 'a due segment',
      should:
        'publish every rendition before any manifest, and record last, so a fact can never pass the media',
      actual: [result.kind, log],
      expected: [
        'released',
        [
          'encode s_0.ts',
          'segment 0/720',
          'segment 0/480',
          'segment 0/240',
          'manifest 720/index.m3u8',
          'manifest 480/index.m3u8',
          'manifest 240/index.m3u8',
          'record 0 4000',
        ],
      ],
    });
  });
  test('a failed publish leaves the cursor and watermark where they were', async () => {
    const { ports, log } = world({
      publishSegment: async () => {
        throw new Error('storage down');
      },
    });
    const outcome = await releaseStep(input(), ports).then(
      () => 'resolved',
      () => 'rejected',
    );
    assert({
      given: 'object storage failing mid-release',
      should:
        'reject without recording, so the retry republishes the same segment',
      actual: [outcome, log.filter((l) => l.startsWith('record'))],
      expected: ['rejected', []],
    });
  });
  test('a fenced worker is told to stop', async () => {
    const { ports } = world({ recordReleased: async () => false });
    assert({
      given: 'the record refused because the lease moved on',
      should: 'report fenced',
      actual: (await releaseStep(input(), ports)).kind,
      expected: 'fenced',
    });
  });
  test('after an outage it stays behind, one segment at a time, skipping nothing', async () => {
    const { ports, log } = world();
    const result = await releaseStep(
      input({ nowMs: start + 900_000, nextSegment: 1 }),
      ports,
    );
    assert({
      given: 'several overdue segments',
      should: 'release only the cursor segment',
      actual: [
        result.kind === 'released' && result.released.seq,
        log.filter((l) => l.startsWith('encode')),
      ],
      expected: [1, ['encode s_1.ts']],
    });
  });
  test('the manifest window comes from the durable hold, so a crash keeps it', async () => {
    const seen: string[] = [];
    const { ports } = world({
      readHoldPlaylist: async () => playlist(10),
      publishManifest: async (_key, text) => {
        seen.push(text);
      },
    });
    await releaseStep(input({ nextSegment: 7, nowMs: start + 900_000 }), ports);
    assert({
      given:
        'a worker restarted with cursor 7 and no memory of earlier segments',
      should: 'publish the newest six up to the cursor, and nothing beyond it',
      actual: [
        seen[0]!.includes('#EXT-X-MEDIA-SEQUENCE:2'),
        seen[0]!.includes('seg-7.ts'),
        seen[0]!.includes('seg-8.ts'),
      ],
      expected: [true, true, false],
    });
  });
});
