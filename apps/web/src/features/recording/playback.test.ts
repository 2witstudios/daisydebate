import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RecordingViewer } from './audience';
import {
  account,
  at,
  deps,
  prefix,
  record,
  round,
  visitor,
} from './fixture.test-support';
import { openPlayback } from './playback';

setupRitewayBun();

describe('openPlayback', () => {
  const open = (
    d: ReturnType<typeof deps>,
    path: string[],
    viewer: RecordingViewer = visitor,
  ) => openPlayback(d, { recordingId: 'rec', path, viewer });

  test('authorizes every read and signs only briefly', async () => {
    assert({
      given: 'a playlist',
      should: 'answer it here, so its relative paths return through this check',
      actual: await open(deps(), ['master.m3u8']),
      expected: { kind: 'playlist', text: '#EXTM3U' },
    });
    assert({
      given: 'a segment',
      should: 'redirect to a read signed for 60 seconds',
      actual: await open(deps(), ['720p', 'seg_1.ts']),
      expected: {
        kind: 'redirect',
        url: `https://store.test/${prefix}hls/720p/seg_1.ts?expires=60`,
      },
    });
  });

  test('refuses what is hidden, gone or malformed alike', async () => {
    const down = record({
      lifecycle: { status: 'taken_down', takenDownAt: at, held: null },
    });
    for (const [given, attempt] of [
      ['a Recording taken down', () => open(deps(down), ['master.m3u8'])],
      [
        'a private Round and a stranger',
        () =>
          open(
            deps(record(), { round: { ...round, visibility: 'private' } }),
            ['master.m3u8'],
            account('stranger'),
          ),
      ],
      ['a path escaping the tree', () => open(deps(), ['..', 'video.mp4'])],
      ['a file that is not media', () => open(deps(), ['secrets.json'])],
    ] as const)
      await assertRejects({
        given,
        should: 'answer not found',
        actual: attempt,
        code: 'NOT_FOUND',
      });
  });
});
