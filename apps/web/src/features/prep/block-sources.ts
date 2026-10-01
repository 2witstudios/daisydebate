import { readWords, currentVersion } from './card';
import { getBrief } from './get-brief';
import { getCard } from './get-card';
import { defaultLibraryQuery, MAX_FIELD_LENGTH } from './library-query';
import { listLibrary } from './list-library';
import { formatClock, readSeconds } from './reading-time';

export type BlockSource = {
  readonly id: string;
  readonly kind: 'brief' | 'card';
  readonly title: string;
  /** "Brief · 2 sections" or "Card · 0:11". */
  readonly detail: string;
};

/**
 * What the case builder can add to a speech: the owner's briefs and cards
 * that match a search. It reads the library seam, so it moves with it.
 */
export function findBlockSources(
  q: string,
  now: string,
  pace: number,
): readonly BlockSource[] {
  const { rows } = listLibrary(
    {
      ...defaultLibraryQuery,
      q: q.trim().slice(0, MAX_FIELD_LENGTH),
      sort: 'title',
    },
    now,
  );
  return rows.flatMap((row): readonly BlockSource[] => {
    if (row.kind === 'brief') {
      const brief = getBrief(row.id);
      return brief === undefined
        ? []
        : [
            {
              id: row.id,
              kind: 'brief',
              title: row.title,
              detail: `Brief · ${brief.contentions.length + 1} sections`,
            },
          ];
    }
    if (row.kind === 'card') {
      const card = getCard(row.id);
      return card === undefined
        ? []
        : [
            {
              id: row.id,
              kind: 'card',
              title: row.title,
              detail: `Card · ${formatClock(readSeconds(readWords(currentVersion(card).segments), pace))}`,
            },
          ];
    }
    return [];
  });
}
