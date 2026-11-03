import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseHoldPlaylist } from './egress-hold-playlist';

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
