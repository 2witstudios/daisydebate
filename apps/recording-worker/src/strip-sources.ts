import {
  holdAttemptPrefix,
  parseHoldPlaylist,
  wholeSegmentsInside,
  type HoldEntry,
  type PublicInterval,
} from '@daisy/protocol';
import { HOLD_PLAYLIST } from './attempt-source';

type HoldPort = {
  readonly readText: (key: string) => Promise<string>;
  readonly listNames: (prefix: string) => Promise<readonly string[]>;
  readonly writeText: (key: string, text: string) => Promise<void>;
  readonly deleteKey: (key: string) => Promise<void>;
};

const playlistOf = (entries: readonly HoldEntry[]) =>
  [
    '#EXTM3U',
    ...entries.flatMap((entry) => [
      `#EXT-X-PROGRAM-DATE-TIME:${new Date(entry.capturedAtMs).toISOString()}`,
      `#EXTINF:${(entry.durationMs / 1000).toFixed(3)},`,
      entry.name,
    ]),
    '',
  ].join('\n');

const attemptsUnder = (prefix: string, names: readonly string[]) =>
  [
    ...new Set(
      names.flatMap((name) => {
        const attempt = Number(name.split('/', 1)[0]);
        return Number.isInteger(attempt) && attempt > 0 ? [attempt] : [];
      }),
    ),
  ].map((attempt) => holdAttemptPrefix(prefix, attempt));

/**
 * A failed Recording's hold cut down to whole segments history proves public. The
 * playlist is rewritten first, so a crash repeats harmlessly and nothing it names is
 * ever gone. The whole file goes, since it holds everything, as does anything with no
 * capture time: what cannot be placed is not known public.
 */
export const stripSources = async (
  hold: HoldPort,
  holdPrefix: string,
  intervals: readonly PublicInterval[],
  nowMs: number,
): Promise<void> => {
  const attempts = attemptsUnder(holdPrefix, await hold.listNames(holdPrefix));
  for (const prefix of attempts) {
    const kept = wholeSegmentsInside(
      parseHoldPlaylist(await hold.readText(`${prefix}${HOLD_PLAYLIST}`), nowMs),
      intervals,
    );
    await hold.writeText(`${prefix}${HOLD_PLAYLIST}`, playlistOf(kept));
    const keep = new Set([HOLD_PLAYLIST, ...kept.map((entry) => entry.name)]);
    for (const name of await hold.listNames(prefix))
      if (!keep.has(name)) await hold.deleteKey(`${prefix}${name}`);
  }
};
