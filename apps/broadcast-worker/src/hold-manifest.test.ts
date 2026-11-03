import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { CONTENT_MODERATION_DELIVERY_BOUND_MS } from '@daisy/protocol';
import {
  masterPlaylist,
  mediaPlaylist,
  RENDITIONS,
  SEGMENT_CACHE_CONTROL,
} from './hold-manifest';

setupRitewayBun();

describe('mediaPlaylist', () => {
  const released = [3, 4].map((seq) => ({
    seq,
    capturedAtMs: Date.parse('2026-11-02T00:00:00.000Z') + seq * 4000,
    durationMs: seq === 4 ? 1500 : 4000,
  }));
  test('carries capture time and a target that fits every segment', () => {
    assert({
      given: 'released segments, the last one short',
      should: 'set the target from the longest and the sequence from the first',
      actual: mediaPlaylist(released, { ended: false }),
      expected:
        '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:3\n' +
        '#EXT-X-PROGRAM-DATE-TIME:2026-11-02T00:00:12.000Z\n#EXTINF:4.000,\nseg-3.ts\n' +
        '#EXT-X-PROGRAM-DATE-TIME:2026-11-02T00:00:16.000Z\n#EXTINF:1.500,\nseg-4.ts\n',
    });
  });
  test('a finished Broadcast tells players the stream ended', () => {
    assert({
      given: 'the final playlist',
      should: 'end with the end tag',
      actual: mediaPlaylist(released, { ended: true }).endsWith(
        'seg-4.ts\n#EXT-X-ENDLIST\n',
      ),
      expected: true,
    });
  });
});

test('masterPlaylist offers the three qualities', () => {
  assert({
    given: 'the renditions',
    should: 'list 720p, 480p and 240p',
    actual: [
      RENDITIONS.map((r) => r.name),
      masterPlaylist().includes('RESOLUTION=1280x720\n720/index.m3u8'),
      masterPlaylist().includes('RESOLUTION=426x240\n240/index.m3u8'),
    ],
    expected: [['720', '480', '240'], true, true],
  });
});

test('a released segment cannot outlive a takedown at the edge', () => {
  const seconds = Number(/max-age=(\d+)/.exec(SEGMENT_CACHE_CONTROL)?.[1]);
  assert({
    given: "the segments' cache lifetime and the 60 s takedown bound",
    should: 'leave at least half the bound for the delete itself',
    actual: seconds * 1000 <= CONTENT_MODERATION_DELIVERY_BOUND_MS / 2,
    expected: true,
  });
});
