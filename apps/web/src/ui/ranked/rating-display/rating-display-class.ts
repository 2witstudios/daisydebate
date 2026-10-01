import type { RatingKind } from '../../../features/ranked/standing';
import type { BadgeTone } from '../../components/badge/badge-class';

const figures: Readonly<Record<RatingKind, string>> = {
  provisional: 'font-display text-display-sm leading-none font-bold',
  established: 'font-display text-display-sm leading-none font-bold',
  unrated: 'font-display text-3xl leading-none font-bold text-ink-faint',
};

/** The big figure: a number in the display voice, or the muted word. */
export const figureClass = (kind: RatingKind): string => figures[kind];

/** Provisional reads gold, established accent, unrated neutral. */
export function statusTone(kind: RatingKind): BadgeTone {
  switch (kind) {
    case 'provisional':
      return 'gold';
    case 'established':
      return 'accent';
    case 'unrated':
      return 'neutral';
  }
}
