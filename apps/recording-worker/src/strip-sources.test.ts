import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { stripSources } from './strip-sources';

setupRitewayBun();

const T0 = Date.parse('2026-11-03T10:00:00.000Z');
const line = (name: string, atMs: number) =>
  `#EXT-X-PROGRAM-DATE-TIME:${new Date(atMs).toISOString()}\n#EXTINF:4.000,\n${name}\n`;

const bucket = () => {
  const files = new Map<string, string>([
    [
      'hold/b/1/p.m3u8',
      `#EXTM3U\n${line('s0.ts', T0)}${line('s1.ts', T0 + 4000)}${line('s2.ts', T0 + 8000)}`,
    ],
    ['hold/b/1/s0.ts', 'x'],
    ['hold/b/1/s1.ts', 'x'],
    ['hold/b/1/s2.ts', 'x'],
    ['hold/b/1/full.mp4', 'x'],
    ['hold/b/1/live.m3u8', 'x'],
    ['hold/b/2/s9.ts', 'x'],
  ]);
  return {
    files,
    port: {
      readText: async (key: string) => files.get(key) ?? '',
      listNames: async (prefix: string) =>
        [...files.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length)),
      writeText: async (key: string, text: string) => {
        files.set(key, text);
      },
      deleteKey: async (key: string) => {
        files.delete(key);
      },
    },
  };
};

describe('stripSources', () => {
  test('only whole segments known public remain, and the playlist says so', async () => {
    const { files, port } = bucket();
    await stripSources(port, 'hold/b/', [
      { fromMs: T0 + 3000, toMs: T0 + 8500 },
    ]);
    assert({
      given:
        'an attempt with a whole file, a straddler each side and one inside, and one with no playlist',
      should: 'keep that one segment, and everything else goes',
      actual: [
        [...files.keys()].sort(),
        files.get('hold/b/1/p.m3u8')?.includes('s1.ts'),
        files.get('hold/b/1/p.m3u8')?.includes('s0.ts'),
      ],
      expected: [
        ['hold/b/1/p.m3u8', 'hold/b/1/s1.ts', 'hold/b/2/p.m3u8'],
        true,
        false,
      ],
    });
  });
  test('nothing known public leaves nothing but an empty playlist, and a repeat is harmless', async () => {
    const { files, port } = bucket();
    await stripSources(port, 'hold/b/', []);
    const once = [...files.keys()].sort();
    await stripSources(port, 'hold/b/', []);
    assert({
      given: 'a failure before any public interval, run twice',
      should: 'leave only empty playlists, the same both times',
      actual: [once, [...files.keys()].sort()],
      expected: [
        ['hold/b/1/p.m3u8', 'hold/b/2/p.m3u8'],
        ['hold/b/1/p.m3u8', 'hold/b/2/p.m3u8'],
      ],
    });
  });
});
