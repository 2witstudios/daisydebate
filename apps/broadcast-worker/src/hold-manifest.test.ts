import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  masterPlaylist,
  mediaPlaylist,
  parseHoldPlaylist,
  RENDITIONS,
  SEGMENT_CACHE_CONTROL,
} from './hold-manifest';

setupRitewayBun();

describe('parseHoldPlaylist', () => {
  test('reads each segment with its capture time and duration', () => {
    assert({
      given: 'an Egress playlist',
      should: 'return segments in order with capture time and integer ms',
      actual: parseHoldPlaylist(
        '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-PROGRAM-DATE-TIME:2026-11-02T00:00:00.000Z\n#EXTINF:4.000,\ns_00000.ts\n#EXT-X-PROGRAM-DATE-TIME:2026-11-02T00:00:04.000Z\n#EXTINF:3.500,\ns_00001.ts\n',
      ),
      expected: [
        {
          name: 's_00000.ts',
          capturedAtMs: Date.parse('2026-11-02T00:00:00.000Z'),
          durationMs: 4000,
        },
        {
          name: 's_00001.ts',
          capturedAtMs: Date.parse('2026-11-02T00:00:04.000Z'),
          durationMs: 3500,
        },
      ],
    });
  });
  test('a segment with no capture time is not returned, so it cannot be released', () => {
    assert({
      given: 'a segment lacking a program date time',
      should: 'stop at it rather than guess when it was captured',
      actual: parseHoldPlaylist('#EXTM3U\n#EXTINF:4.000,\ns_00000.ts\n'),
      expected: [],
    });
  });
});

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
  assert({
    given:
      'that Tigris keeps serving a read object past its delete at max-age=10',
    should: 'revalidate every read, so a takedown reaches every viewer',
    actual: SEGMENT_CACHE_CONTROL,
    expected: 'no-cache',
  });
});
