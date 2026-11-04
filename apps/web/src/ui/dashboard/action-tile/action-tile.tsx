import Link from 'next/link';
import { cn } from '../../cn';
import {
  destinationPrefetch,
  type DestinationSlug,
} from '../../../features/destinations/destinations';
import type { SeasonGlance } from '../../../features/leaderboard/season';
import type { NoteColor, NoteTilt } from './action-tile-class';
import {
  noteCopyClass,
  notePaperClass,
  noteTiltClass,
} from './action-tile-class';
import { NoteGlyph } from './note-glyph/note-glyph';

export type ActionTileProps = {
  readonly href: string;
  /** Whose icon the note wears. */
  readonly destination: DestinationSlug;
  readonly title: string;
  readonly description: string;
  readonly note: NoteColor;
  readonly tilt: NoteTilt;
  /** The Seasons note's reveal; null when no season is running. */
  readonly seasonGlance?: SeasonGlance | null;
};

/** One destination on Home, as a curled note stuck to the page. */
export function ActionTile({
  href,
  destination,
  title,
  description,
  note,
  tilt,
  seasonGlance = null,
}: ActionTileProps) {
  return (
    <Link
      href={href}
      prefetch={destinationPrefetch(href)}
      className={cn(
        'note flex h-full flex-col gap-4 p-6 no-underline hover:no-underline',
        notePaperClass(note),
        noteTiltClass(tilt),
      )}
    >
      <NoteGlyph destination={destination} seasonGlance={seasonGlance} />
      <div className="flex flex-1 flex-col gap-1">
        <h2 className="font-display text-xl leading-tile-title font-semibold tracking-tight">
          {title}
        </h2>
        <p className={cn('text-base leading-tile-copy', noteCopyClass(note))}>
          {description}
        </p>
      </div>
    </Link>
  );
}
