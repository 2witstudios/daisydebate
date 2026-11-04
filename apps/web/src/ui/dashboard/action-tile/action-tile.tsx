import Link from 'next/link';
import { cn } from '../../cn';
import type { IconName } from '../../components/icon/icon';
import { Icon } from '../../components/icon/icon';
import type { NoteColor, NoteTilt } from './action-tile-class';
import {
  noteCopyClass,
  notePaperClass,
  noteTiltClass,
} from './action-tile-class';

export type ActionTileProps = {
  readonly href: string;
  /** Icon name from the shared stroke icon set. */
  readonly glyph: IconName;
  readonly title: string;
  readonly description: string;
  readonly note: NoteColor;
  readonly tilt: NoteTilt;
};

/** One destination on Home, as a curled note stuck to the page. */
export function ActionTile({
  href,
  glyph,
  title,
  description,
  note,
  tilt,
}: ActionTileProps) {
  return (
    <Link
      href={href}
      className={cn(
        'note flex h-full flex-col gap-4 p-6 no-underline hover:no-underline',
        notePaperClass(note),
        noteTiltClass(tilt),
      )}
    >
      <Icon name={glyph} size={28} strokeWidth={1.6} className="shrink-0" />
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
