import type { RecordingBuildProgress } from '@daisy/protocol';
import { afterAll } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { BuildPorts } from '../src/build-ports';
import { buildRecording } from '../src/build-recording';
import { localFiles, runCommand } from '../src/local-ports';

setupRitewayBun();

const root = await mkdtemp(join(tmpdir(), 'recording-worker-'));
afterAll(() => rm(root, { recursive: true, force: true }));

const ffmpeg = (...args: readonly string[]) =>
  runCommand(new AbortController().signal)([
    'ffmpeg',
    '-y',
    '-loglevel',
    'error',
    ...args,
  ]);

const T0 = Date.parse('2026-11-03T10:00:00.000Z');
const slatePath = new URL('../assets/gap-slate.png', import.meta.url).pathname;

/** A real, moving, audible picture of one attempt: green, so a slate stands apart. */
const source = (
  seconds: number,
  output: string,
  ...format: readonly string[]
) =>
  ffmpeg(
    '-f',
    'lavfi',
    '-i',
    `color=c=green:s=1280x720:r=30:d=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=f=440:d=${seconds}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-g',
    '30',
    '-c:a',
    'aac',
    ...format,
    output,
  );

/** The hold bucket and the Recording bucket as directories, so ffmpeg stays real. */
const setup = async (name: string) => {
  const hold = join(root, name, 'hold');
  const recordings = join(root, name, 'recordings');
  const workDir = join(root, name, 'work');
  await mkdir(hold, { recursive: true });
  await mkdir(recordings, { recursive: true });
  const progressSeen: RecordingBuildProgress[] = [];
  const ports: BuildPorts = {
    hold: {
      readText: async (key) => {
        const file = Bun.file(join(hold, key));
        return (await file.exists()) ? file.text() : '';
      },
      listNames: async (prefix) => readdir(join(hold, prefix)).catch(() => []),
      download: async (key, path) => {
        await Bun.write(path, Bun.file(join(hold, key)));
      },
    },
    recordings: {
      upload: async (key, path) => {
        const target = join(recordings, key);
        await mkdir(dirname(target), { recursive: true });
        await Bun.write(target, Bun.file(path));
      },
      sizes: async (prefix) =>
        new Map(
          [...(await localFiles.list(join(recordings, prefix)))].map(
            ([key, size]) => [`${prefix}${key}`, size] as const,
          ),
        ),
    },
    files: localFiles,
    run: runCommand(new AbortController().signal),
    progress: (progress) => progressSeen.push(progress),
    povMissing: () => undefined,
    slatePath,
    workDir,
    now: () => '2026-11-03T11:00:00.000Z',
  };
  return { hold, recordings, ports, progressSeen };
};

/** Egress's own layout: 4 s TS segments and a timed playlist under the attempt. */
const holdSegments = async (
  dir: string,
  startedAtMs: number,
  seconds: number,
) => {
  await mkdir(dir, { recursive: true });
  await source(
    seconds,
    join(dir, 's_%05d.ts'),
    '-f',
    'segment',
    '-segment_time',
    '4',
    '-segment_format',
    'mpegts',
    '-reset_timestamps',
    '1',
  );
  const names = (await readdir(dir)).filter((n) => n.endsWith('.ts')).sort();
  const lines = names.flatMap((name, index) => [
    `#EXT-X-PROGRAM-DATE-TIME:${new Date(startedAtMs + index * 4000).toISOString()}`,
    '#EXTINF:4.000,',
    name,
  ]);
  await Bun.write(
    join(dir, 'p.m3u8'),
    ['#EXTM3U', ...lines, '#EXT-X-ENDLIST', ''].join('\n'),
  );
};

/** Tests of the build itself: nothing in these Rounds is private. */
const ALL_PUBLIC = [{ fromMs: 0, toMs: 2 ** 52 }];

const durationOf = async (path: string) => {
  const text = await runCommand(new AbortController().signal)([
    'ffprobe',
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    path,
  ]);
  return parseFloat(text);
};

/** The mean green level of the frame at this second: 0 to 255. */
const greenAt = async (path: string, seconds: number) => {
  const frame = join(root, `frame-${Bun.randomUUIDv7()}.rgb`);
  await ffmpeg(
    '-ss',
    String(seconds),
    '-i',
    path,
    '-frames:v',
    '1',
    '-s',
    '16x9',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    frame,
  );
  const bytes = new Uint8Array(await Bun.file(frame).arrayBuffer());
  let green = 0;
  for (let i = 1; i < bytes.length; i += 3) green += bytes[i]!;
  return green / (bytes.length / 3);
};

test('what is not public is cut from a whole attempt, stated, and never built', async () => {
  const { hold, recordings, ports } = await setup('lapse');
  // One clean attempt of 24 s, whole file included, with a lapse in the middle.
  await holdSegments(join(hold, 'hold/b/1'), T0, 24);
  await source(24, join(hold, 'hold/b/1/full.mp4'));
  const state = await buildRecording(ports, {
    recordingId: 'rec',
    holdPrefix: 'hold/b/',
    attemptCount: 1,
    publicIntervals: [
      { fromMs: T0, toMs: T0 + 10_000 },
      { fromMs: T0 + 14_000, toMs: T0 + 24_000 },
    ],
    povs: [],
  });
  if (state.status !== 'built') throw new Error(`state ${state.status}`);
  const { media } = state;
  const [gap] = media.gaps;
  const video = join(recordings, 'recordings/rec/video.mp4');
  assert({
    given: '4 s not public inside an attempt that left a whole file',
    should: 'state exactly that gap, keeping the rest, with no picture from it',
    actual: [
      media.gaps.map((one) => one.reason),
      Math.abs(gap!.startMs - 10_000) < 200,
      Math.abs(gap!.endMs - 14_000) < 200,
      (await greenAt(video, 12)) < 60,
      (await greenAt(video, 9)) > 60,
      (await greenAt(video, 15)) > 60,
    ],
    expected: [['not_public'], true, true, true, true, true],
  });
});

test('a crashed attempt, a gap and a clean attempt become one honest video', async () => {
  const { hold, recordings, ports, progressSeen } = await setup('restart');
  // Attempt 1 crashed: segments only, no whole file. 8 s of media.
  await holdSegments(join(hold, 'hold/b/1'), T0, 8);
  // 12 s lost. Attempt 2 finished cleanly: a whole file and its playlist. 8 s.
  await holdSegments(join(hold, 'hold/b/2'), T0 + 20_000, 8);
  await source(8, join(hold, 'hold/b/2/full.mp4'));

  const state = await buildRecording(ports, {
    recordingId: 'rec',
    holdPrefix: 'hold/b/',
    attemptCount: 2,
    publicIntervals: ALL_PUBLIC,
    povs: [],
  });
  if (state.status !== 'built') throw new Error(`state ${state.status}`);
  const { media } = state;
  const video = join(recordings, 'recordings/rec/video.mp4');
  const encoding = progressSeen.filter(({ step }) => step === 'encoding');
  assert({
    given: 'a real ffmpeg build',
    should: 'report every step in order, and encoded video counting up',
    actual: [
      [...new Set(progressSeen.map(({ step }) => step))],
      encoding.length > 0,
      encoding.every(
        ({ done, total }, index) =>
          done <= total && done >= (encoding[index - 1]?.done ?? 0),
      ),
      Math.abs((encoding.at(-1)?.done ?? 0) - media.durationMs) < 1000,
    ],
    expected: [
      ['reading', 'composing', 'encoding', 'uploading', 'verifying'],
      true,
      true,
      true,
    ],
  });
  assert({
    given: 'two attempts with 12 s between them',
    should: 'state the gap at its real place, in video time',
    actual: [
      media.capturedFrom,
      media.gaps.map((gap) => gap.reason),
      Math.abs(media.gaps[0]!.startMs - 8000) < 500,
      Math.abs(media.gaps[0]!.endMs - 20_000) < 1,
      Math.abs(media.durationMs - 28_000) < 1000,
    ],
    expected: [
      new Date(T0).toISOString(),
      ['capture_restart'],
      true,
      true,
      true,
    ],
  });
  assert({
    given: 'the whole video a subscriber downloads',
    should: 'show the attempts and, between them, not their picture',
    actual: [
      (await greenAt(video, 4)) > 60,
      (await greenAt(video, 14)) < 60,
      (await greenAt(video, 24)) > 60,
      Math.abs((await durationOf(video)) - 28) < 1,
    ],
    expected: [true, true, true, true],
  });
  const rendition = (name: string) =>
    Bun.file(join(recordings, `recordings/rec/hls/${name}/index.m3u8`)).text();
  const stored = await localFiles.list(join(recordings, 'recordings/rec'));
  assert({
    given: 'the HLS built from it',
    should: 'have a master, three finished renditions and every segment',
    actual: [
      stored.has('hls/master.m3u8'),
      (await rendition('720')).includes('#EXT-X-ENDLIST'),
      (await rendition('480')).includes('#EXT-X-ENDLIST'),
      (await rendition('240')).includes('#EXT-X-ENDLIST'),
      stored.has('hls/720/seg-00000.ts'),
      media.playlistKey,
      media.downloadKey,
    ],
    expected: [
      true,
      true,
      true,
      true,
      true,
      'recordings/rec/hls/master.m3u8',
      'recordings/rec/video.mp4',
    ],
  });
  assert({
    given: 'a stated size',
    should: 'count every object stored',
    actual: media.byteSize,
    expected: [...stored.values()].reduce((sum, size) => sum + size, 0),
  });
  const again = await buildRecording(ports, {
    recordingId: 'rec',
    holdPrefix: 'hold/b/',
    attemptCount: 2,
    publicIntervals: ALL_PUBLIC,
    povs: [],
  });
  assert({
    given: 'the build repeated after a crash',
    should: 'land on the same keys and gaps',
    actual:
      again.status === 'built'
        ? [again.media.playlistKey, again.media.gaps]
        : again.status,
    expected: [media.playlistKey, media.gaps],
  });
}, 180_000);

test('one clean attempt is that file, not encoded again', async () => {
  const { hold, recordings, ports } = await setup('clean');
  await holdSegments(join(hold, 'hold/b/1'), T0, 8);
  await source(8, join(hold, 'hold/b/1/full.mp4'));
  const state = await buildRecording(ports, {
    recordingId: 'rec',
    holdPrefix: 'hold/b/',
    attemptCount: 1,
    publicIntervals: ALL_PUBLIC,
    povs: [],
  });
  assert({
    given: 'one attempt',
    should: 'have no gap and the source length',
    actual:
      state.status === 'built'
        ? [state.media.gaps, Math.abs(state.media.durationMs - 8000) < 500]
        : state.status,
    expected: [[], true],
  });
  assert({
    given: 'the download',
    should: 'be the source stream, moved to a seekable file',
    actual:
      Math.abs(
        (await durationOf(join(recordings, 'recordings/rec/video.mp4'))) - 8,
      ) < 0.5,
    expected: true,
  });
}, 120_000);

test('a corrupt whole file falls back to its segments', async () => {
  const { hold, ports } = await setup('corrupt');
  await holdSegments(join(hold, 'hold/b/1'), T0, 8);
  await Bun.write(join(hold, 'hold/b/1/full.mp4'), 'not a video');
  const state = await buildRecording(ports, {
    recordingId: 'rec',
    holdPrefix: 'hold/b/',
    attemptCount: 1,
    publicIntervals: ALL_PUBLIC,
    povs: [],
  });
  assert({
    given: 'a whole file ffprobe cannot read and intact segments',
    should: 'still build, from the segments',
    actual:
      state.status === 'built'
        ? Math.abs(state.media.durationMs - 8000) < 500
        : state.status,
    expected: true,
  });
}, 120_000);

test('an attempt with no audio joins with silence, so the video stays whole', async () => {
  const { hold, recordings, ports } = await setup('silent');
  await holdSegments(join(hold, 'hold/b/1'), T0, 8);
  await holdSegments(join(hold, 'hold/b/2'), T0 + 8000, 8);
  await ffmpeg(
    '-f',
    'lavfi',
    '-i',
    'color=c=green:s=1280x720:r=30:d=8',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    join(hold, 'hold/b/2/full.mp4'),
  );
  const state = await buildRecording(ports, {
    recordingId: 'rec',
    holdPrefix: 'hold/b/',
    attemptCount: 2,
    publicIntervals: ALL_PUBLIC,
    povs: [],
  });
  const streams = await runCommand(new AbortController().signal)([
    'ffprobe',
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type',
    '-of',
    'csv=p=0',
    join(recordings, 'recordings/rec/video.mp4'),
  ]);
  assert({
    given: 'one attempt with sound and one without',
    should: 'build one video with one audio stream throughout',
    actual: [
      state.status,
      streams.trim().split('\n').sort(),
      Math.abs(
        (await durationOf(join(recordings, 'recordings/rec/video.mp4'))) - 16,
      ) < 1,
    ],
    expected: ['built', ['audio', 'video'], true],
  });
}, 120_000);

test('capture that left nothing reports no media', async () => {
  const { ports } = await setup('empty');
  assert({
    given: 'attempts with no objects at all',
    should: 'say no media, never build an empty video',
    actual: await buildRecording(ports, {
      recordingId: 'rec',
      holdPrefix: 'hold/b/',
      attemptCount: 2,
      publicIntervals: ALL_PUBLIC,
      povs: [],
    }),
    expected: {
      status: 'failed',
      reason: 'no_media',
      failedAt: '2026-11-03T11:00:00.000Z',
    },
  });
});

/** A composite and one debater's capture, both on the same 24 s of real time. */
const withPov = async (name: string) => {
  const built = await setup(name);
  await holdSegments(join(built.hold, 'hold/b/1'), T0, 24);
  await source(24, join(built.hold, 'hold/b/1/full.mp4'));
  await holdSegments(join(built.hold, 'recording-hold/rec/pov/seat/1'), T0, 24);
  await source(24, join(built.hold, 'recording-hold/rec/pov/seat/1/full.mp4'));
  return built;
};
const PRIVATE_MIDDLE = [
  { fromMs: T0, toMs: T0 + 10_000 },
  { fromMs: T0 + 14_000, toMs: T0 + 24_000 },
];
const job = {
  recordingId: 'rec',
  holdPrefix: 'hold/b/',
  attemptCount: 1,
  publicIntervals: PRIVATE_MIDDLE,
};

test('a POV shows nothing the gate did not pass, in sync with the composite', async () => {
  const { recordings, ports } = await withPov('with-view');
  const state = await buildRecording(ports, {
    ...job,
    povs: [{ roundParticipantId: 'seat', picture: '540p', attemptCount: 1 }],
  });
  if (state.status !== 'built') throw new Error(`state ${state.status}`);
  const [pov] = state.media.povs ?? [];
  if (pov?.status !== 'built') throw new Error('pov not built');
  const video = join(recordings, pov.video!.key);
  const audio = join(recordings, pov.audio.key);
  const streams = await runCommand(new AbortController().signal)([
    'ffprobe',
    '-v',
    'error',
    '-show_entries',
    'stream=codec_name',
    '-of',
    'csv=p=0',
    audio,
  ]);
  assert({
    given: '4 s not public inside a debater’s capture',
    should:
      'slate exactly that, at the composite’s length, with its voice as its own file',
    actual: [
      pov.gaps.map((gap) => gap.reason),
      Math.abs(pov.gaps[0]!.startMs - 10_000) < 200,
      (await greenAt(video, 12)) < 60,
      (await greenAt(video, 9)) > 60,
      (await greenAt(video, 15)) > 60,
      Math.abs((await durationOf(video)) - state.media.durationMs / 1000) < 1,
      Math.abs((await durationOf(audio)) - state.media.durationMs / 1000) < 1,
      streams.trim(),
      pov.video!.key,
      pov.video!.quality,
    ],
    expected: [
      ['not_public'],
      true,
      true,
      true,
      true,
      true,
      true,
      'aac',
      'recordings/rec/pov/seat/video.mp4',
      '540p',
    ],
  });
}, 120_000);

test('a debater with no camera gets their voice, and no video file', async () => {
  const { recordings, ports } = await withPov('voice-only');
  const state = await buildRecording(ports, {
    ...job,
    povs: [{ roundParticipantId: 'seat', picture: null, attemptCount: 1 }],
  });
  if (state.status !== 'built') throw new Error(`state ${state.status}`);
  const [pov] = state.media.povs ?? [];
  if (pov?.status !== 'built') throw new Error('pov not built');
  assert({
    given: 'a bot debater',
    should: 'keep audio alone',
    actual: [
      pov.video,
      await Bun.file(join(recordings, pov.audio.key)).exists(),
      await Bun.file(
        join(recordings, 'recordings/rec/pov/seat/video.mp4'),
      ).exists(),
    ],
    expected: [null, true, false],
  });
}, 120_000);

test('a failed POV leaves the Recording built, with that one listed as missing', async () => {
  const { ports } = await withPov('one-fails');
  let missing = 0;
  const failing: BuildPorts = {
    ...ports,
    povMissing: () => {
      missing += 1;
    },
    run: (command, onEncodedMs, withinMs) =>
      command.at(-1)?.includes('/pov-0-')
        ? Promise.reject(new Error('encoder died'))
        : ports.run(command, onEncodedMs, withinMs),
  };
  const state = await buildRecording(failing, {
    ...job,
    povs: [
      { roundParticipantId: 'seat', picture: '360p', attemptCount: 1 },
      { roundParticipantId: 'never', picture: '540p', attemptCount: 0 },
    ],
  });
  if (state.status !== 'built') throw new Error(`state ${state.status}`);
  assert({
    given: 'one POV that cannot be built and one that never ran',
    should: 'still build the composite, list both, and say so once',
    actual: [state.media.povs, missing],
    expected: [
      [
        {
          status: 'missing',
          roundParticipantId: 'seat',
          reason: 'build_failed',
        },
        {
          status: 'missing',
          roundParticipantId: 'never',
          reason: 'never_captured',
        },
      ],
      1,
    ],
  });
}, 120_000);
