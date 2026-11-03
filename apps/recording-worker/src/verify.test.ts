import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { verificationProblem } from './verify';

setupRitewayBun();

const playlist = (seconds: number, ended = true) =>
  `#EXTM3U\n#EXTINF:${seconds}.000,\nseg-00000.ts\n${ended ? '#EXT-X-ENDLIST\n' : ''}`;
const root = 'recordings/r/hls/';
const written = new Map<string, number>([
  ['recordings/r/video.mp4', 100],
  ...['720', '480', '240'].map(
    (name) => [`${root}${name}/seg-00000.ts`, 10] as const,
  ),
]);
const good = {
  expectedDurationMs: 60_000,
  downloadDurationMs: 60_100,
  downloadKey: 'recordings/r/video.mp4',
  hlsRoot: root,
  playlists: { 720: playlist(60), 480: playlist(60), 240: playlist(60) },
  written,
  stored: written,
};

describe('verificationProblem', () => {
  test('passes only a complete, full-length video', () => {
    assert({
      given: 'every rendition and object as written',
      should: 'find no problem',
      actual: verificationProblem(good),
      expected: null,
    });
  });
  test('finds each way a Recording could be falsely ready', () => {
    const cases: readonly [string, typeof good, string][] = [
      [
        'a short download',
        { ...good, downloadDurationMs: 30_000 },
        'download_duration',
      ],
      [
        'a rendition still open',
        { ...good, playlists: { ...good.playlists, 480: playlist(60, false) } },
        'playlist_unfinished_480',
      ],
      [
        'a short rendition',
        { ...good, playlists: { ...good.playlists, 240: playlist(20) } },
        'playlist_duration_240',
      ],
      [
        'a segment never written',
        {
          ...good,
          written: new Map(
            [...written].filter(([key]) => !key.includes('720/')),
          ),
        },
        'segment_missing_720',
      ],
      [
        'an object missing from the bucket',
        {
          ...good,
          stored: new Map(
            [...written].filter(([key]) => !key.endsWith('video.mp4')),
          ),
        },
        'object_mismatch',
      ],
      [
        'an upload cut short',
        {
          ...good,
          stored: new Map([...written, ['recordings/r/video.mp4', 7]]),
        },
        'object_mismatch',
      ],
    ];
    for (const [given, input, expected] of cases)
      assert({
        given,
        should: 'refuse it',
        actual: verificationProblem(input),
        expected,
      });
  });
});
