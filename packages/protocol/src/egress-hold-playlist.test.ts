import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseHoldPlaylist } from './egress-hold-playlist';

setupRitewayBun();

const LATER = Date.parse('2030-01-01T00:00:00.000Z');

describe('parseHoldPlaylist', () => {
  test('reads each segment with its capture time and duration', () => {
    assert({
      given: 'an Egress playlist',
      should: 'return segments in order with capture time and integer ms',
      actual: parseHoldPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-PROGRAM-DATE-TIME:2026-11-02T00:00:00.000Z\n#EXTINF:4.000,\ns_00000.ts\n#EXT-X-PROGRAM-DATE-TIME:2026-11-02T00:00:04.000Z\n#EXTINF:3.500,\ns_00001.ts\n', LATER),
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
      actual: parseHoldPlaylist('#EXTM3U\n#EXTINF:4.000,\ns_00000.ts\n', LATER),
      expected: [],
    });
  });
});

describe('a held playlist is not believed past its first lie', () => {
  const entry = (at: string, name = 's.ts') =>
    `#EXT-X-PROGRAM-DATE-TIME:${at}\n#EXTINF:4.000,\n${name}\n`;
  const names = (text: string, nowMs = LATER) =>
    parseHoldPlaylist(`#EXTM3U\n${text}`, nowMs).map(({ name }) => name);
  const t = (seconds: number) =>
    new Date(Date.UTC(2026, 10, 2, 0, 0, seconds)).toISOString();
  test('names outside the allowlist stop it', () => {
    assert({
      given: 'a good segment, then a path, a hidden name and a non-segment',
      should: 'keep only what comes before each',
      actual: [
        names(entry(t(0), 'a.ts') + entry(t(4), '../other/b.ts')),
        names(entry(t(0), 'a.ts') + entry(t(4), '.hidden.ts')),
        names(entry(t(0), 'a.ts') + entry(t(4), 'b.m3u8')),
      ],
      expected: [['a.ts'], ['a.ts'], ['a.ts']],
    });
  });
  test('times must rise, and be past', () => {
    assert({
      given: 'a stamp repeating, one going back, and one in the future',
      should: 'stop at each',
      actual: [
        names(entry(t(4), 'a.ts') + entry(t(4), 'b.ts')),
        names(entry(t(4), 'a.ts') + entry(t(0), 'b.ts')),
        names(entry(t(0), 'a.ts') + entry(t(4), 'b.ts'), Date.parse(t(7))),
      ],
      expected: [['a.ts'], ['a.ts'], ['a.ts']],
    });
  });
});
