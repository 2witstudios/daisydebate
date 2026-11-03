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
    encode: async ({ source, offsetMs, durationMs }) => {
      log.push(
        offsetMs === 0 && durationMs === source.durationMs
          ? `encode ${source.name}`
          : `encode ${source.name} ${offsetMs} ${durationMs}`,
      );
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
    recordAdvanced: async () => {
      log.push('advanced');
      return true;
    },
    recordPassed: async (through) => {
      log.push(`passed ${through - start}`);
      return true;
    },
    recordEnded: async (end) => {
      log.push(`ended ${end - start}`);
      return true;
    },
    ...over,
  };
  return { ports, log };
};
const input = (
  over: { nextSegment?: number } & Record<string, unknown> = {},
) => ({
  holdCursor: over.nextSegment ?? 0,
  policy: { kind: 'delay', seconds: 60 } as const,
  nextSegment: 0,
  attemptIndex: 0,
  laterAttemptStartedMs: null,
  streamEnded: false,
  nowMs: start + 64_000,
  finalMediaEndMs: null,
  heartbeatMs: start + 1_000_000,
  publicIntervals: [{ fromMs: start - 1000, toMs: start + 1_000_000 }],
  releasedThroughMs: null,
  ...over,
});

describe('only what history proves public', () => {
  test('past the heartbeat nothing is settled, however due', async () => {
    const { ports, log } = world();
    const answer = await releaseStep(
      input({ heartbeatMs: start + 4_499 }),
      ports,
    );
    assert({
      given: 'a due segment the heartbeat has not passed by its margin',
      should: 'say lapsed and publish nothing',
      actual: [answer.kind, log],
      expected: ['lapsed', []],
    });
  });
  test('settled time with nothing public moves the timeline, and publishes nothing', async () => {
    const { ports, log } = world();
    const answer = await releaseStep(
      input({ publicIntervals: [], nowMs: start + 200_000 }),
      ports,
    );
    const { ports: later, log: laterLog } = world();
    await releaseStep(
      input({
        publicIntervals: [],
        nowMs: start + 200_000,
        releasedThroughMs: start + 12_000,
      }),
      later,
    );
    assert({
      given: 'three due segments with no public interval, then already passed',
      should: 'move the watermark past them once, with no media at all',
      actual: [answer.kind, log, laterLog],
      expected: ['waiting', ['passed 12000'], []],
    });
  });
  test('the watermark stops at the next clip, and waits for it', async () => {
    const { ports, log } = world();
    await releaseStep(
      input({
        publicIntervals: [{ fromMs: start + 6_000, toMs: start + 8_000 }],
        nowMs: start + 4_000 + 60_000,
      }),
      ports,
    );
    assert({
      given: 'a due segment outside, then a clip in the next one not yet due',
      should: 'pass only what is due, and publish nothing',
      actual: log,
      expected: ['passed 4000'],
    });
  });
  test('a segment no interval touches leaves no hole in the sequence', async () => {
    const { ports, log } = world();
    const answer = await releaseStep(
      input({
        publicIntervals: [{ fromMs: start + 4_000, toMs: start + 100_000 }],
        nowMs: start + 200_000,
      }),
      ports,
    );
    assert({
      given: 'the first held segment wholly outside any interval',
      should: 'release the next under the same public sequence',
      actual: [answer.kind, log[0], log.at(-1)],
      expected: ['released', 'encode s_1.ts', 'record 0 8000'],
    });
  });
  test('a boundary inside a segment keeps the public side, and the watermark stops there', async () => {
    const { ports, log } = world();
    const answer = await releaseStep(
      input({
        publicIntervals: [{ fromMs: start + 1_500, toMs: start + 3_000 }],
        nowMs: start + 200_000,
      }),
      ports,
    );
    assert({
      given: 'an interval starting and ending inside the first segment',
      should: 'encode exactly that part, and record its end',
      actual: [answer.kind, log[0], log.at(-1)],
      expected: ['released', 'encode s_0.ts 1500 1500', 'record 0 3000'],
    });
  });
  test('the playlist marks where something was left out, as long as it shows', async () => {
    const manifests: string[] = [];
    const { ports } = world({
      publishManifest: async (_key: string, text: string) => {
        manifests.push(text);
      },
    });
    await releaseStep(
      input({
        holdCursor: 1,
        nextSegment: 1,
        attemptIndex: 0,
        publicIntervals: [
          { fromMs: start, toMs: start + 4_000 },
          { fromMs: start + 8_000, toMs: start + 12_000 },
        ],
        nowMs: start + 200_000,
      }),
      ports,
    );
    assert({
      given: 'a clip released after a stretch not public, in one attempt',
      should: 'start it with a discontinuity',
      actual: manifests[0]?.includes('#EXT-X-DISCONTINUITY\n'),
      expected: true,
    });
  });
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
  test('a cursor past the hold, after final media, ends the stream', async () => {
    const seen: string[] = [];
    const { ports, log } = world({
      publishManifest: async (_key, text) => {
        seen.push(text);
      },
    });
    const finalMediaEndMs = start + 13_000;
    const past = (over = {}) =>
      releaseStep(
        input({
          nextSegment: 3,
          holdCursor: 3,
          finalMediaEndMs,
          nowMs: finalMediaEndMs + 10_000,
          ...over,
        }),
        ports,
      );
    const open = await past({ finalMediaEndMs: null });
    const settling = await past({ nowMs: finalMediaEndMs + 9_999 });
    assert({
      given: 'no final media yet, then a hold still settling after a stop',
      should: 'wait and touch nothing',
      actual: [open.kind, settling.kind, log],
      expected: ['waiting', 'waiting', []],
    });
    assert({
      given: 'the last segment ending a second before the stop, hold settled',
      should: 'mark the end and move the timeline to the end of the media',
      actual: [
        (await past()).kind,
        seen.at(-1)!.includes('ENDLIST'),
        log.at(-1),
      ],
      expected: ['ended', true, 'ended 13000'],
    });
    const before = log.length;
    assert({
      given: 'a stream already ended',
      should: 'do nothing more',
      actual: [(await past({ streamEnded: true })).kind, log.length],
      expected: ['waiting', before],
    });
  });
  test('a Round whose Egress held nothing still ends', async () => {
    const { ports, log } = world({ readHoldPlaylist: async () => '#EXTM3U\n' });
    assert({
      given: 'no held segment at all, after final media',
      should: 'publish no manifest and record the end',
      actual: [
        (
          await releaseStep(
            input({ finalMediaEndMs: start, nowMs: start + 10_000 }),
            ports,
          )
        ).kind,
        log,
      ],
      expected: ['ended', ['ended 0']],
    });
  });
  test('the last segment is released as open until the stream ends', async () => {
    const seen: string[] = [];
    const { ports } = world({
      publishManifest: async (_key, text) => {
        seen.push(text);
      },
    });
    await releaseStep(
      input({
        nextSegment: 2,
        holdCursor: 2,
        finalMediaEndMs: start,
        nowMs: start + 900_000,
      }),
      ports,
    );
    assert({
      given: 'the last held segment after final media',
      should: 'not end the stream until the cursor is past the hold',
      actual: seen.at(-1)!.includes('ENDLIST'),
      expected: false,
    });
  });
  test('an Egress restart drains the old hold, then continues the sequence', async () => {
    const seen: string[] = [];
    const { ports, log } = world({
      publishManifest: async (_key, text) => {
        seen.push(text);
      },
    });
    const later = start + 900_000;
    const drained = {
      nextSegment: 3,
      holdCursor: 3,
      laterAttemptStartedMs: later,
      releasedThroughMs: start + 12_000,
    };
    const settling = await releaseStep(
      input({ ...drained, nowMs: later + 9_999 }),
      ports,
    );
    const moved = await releaseStep(
      input({ ...drained, nowMs: later + 10_000 }),
      ports,
    );
    assert({
      given: 'an emptied hold and a later attempt, before and after it settles',
      should: 'wait, then advance, and never end the stream',
      actual: [settling.kind, moved.kind, log, seen],
      expected: ['waiting', 'advanced', ['advanced'], []],
    });
    await releaseStep(
      input({
        nextSegment: 3,
        holdCursor: 0,
        attemptIndex: 1,
        nowMs: start + 900_000,
      }),
      ports,
    );
    const text = seen.at(-1)!;
    assert({
      given: 'the first segment of the second attempt',
      should: 'keep the public sequence and mark the discontinuity',
      actual: [
        text.includes('#EXT-X-MEDIA-SEQUENCE:3'),
        text.includes('#EXT-X-DISCONTINUITY\n'),
        text.includes('seg-3.ts'),
      ],
      expected: [true, true, true],
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
    await releaseStep(
      input({ nextSegment: 7, holdCursor: 7, nowMs: start + 900_000 }),
      ports,
    );
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
