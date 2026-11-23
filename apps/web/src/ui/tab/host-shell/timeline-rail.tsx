import Link from 'next/link';
import {
  standingLabel,
  type RailItem,
  type TimelineRail as Rail,
} from '../../../features/tab/tournament';
import { cn } from '../../cn';
import { UnavailableControl } from '../action-control/unavailable-control';
import { BackButton } from '../action-control/action-control';
import { eyebrowClass } from '../list-card/list-card';

/** A stop's shape as a link; its disabled stand-in is a menu row. */
const stopShape = 'justify-between gap-3 rounded-sm px-3 py-2';
const stopClass = `flex ${stopShape}`;

function Stop({
  item,
  current,
}: {
  readonly item: RailItem;
  readonly current: boolean;
}) {
  const face = (
    <>
      <span className="flex min-w-0 gap-2">
        {item.time === null ? null : (
          <span className="tabular-nums">{item.time}</span>
        )}
        <span>{item.label}</span>
      </span>
      {item.standing === null ? null : (
        <span className="text-sm">{standingLabel(item.standing)}</span>
      )}
    </>
  );
  if (item.action === null)
    return <span className={cn(stopClass, 'text-ink-muted')}>{face}</span>;
  if (item.action.kind === 'unavailable')
    return (
      <UnavailableControl
        look={{ variant: 'row', size: 'menu' }}
        className="justify-between"
      >
        {face}
      </UnavailableControl>
    );
  return (
    <Link
      href={item.action.href}
      aria-current={current ? 'page' : undefined}
      className={cn(
        stopClass,
        'no-underline hover:no-underline',
        current
          ? 'bg-accent font-bold text-accent-ink'
          : 'text-ink hover:bg-surface-sunken',
      )}
    >
      {face}
    </Link>
  );
}

/**
 * The host area's navigation: the tournament in order, by time slot, then
 * the pages that stand beside the timeline. With one event the slots are its
 * rounds.
 */
export function TimelineRail({
  rail,
  current,
}: {
  readonly rail: Rail;
  /** The stop the page is on. */
  readonly current: string | null;
}) {
  return (
    <nav
      aria-label={rail.title}
      className="sticky top-0 flex h-screen w-host-rail shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-surface px-3 py-5 max-compact:static max-compact:h-auto max-compact:w-full max-compact:border-r-0 max-compact:border-b"
    >
      <BackButton href="/" label="Back to Daisy" className="ml-3" />
      <div className="flex flex-col px-3">
        <strong className="font-display text-xl font-bold">{rail.title}</strong>
        {rail.subtitle === null ? null : (
          <span className="text-sm text-ink-muted">{rail.subtitle}</span>
        )}
      </div>
      <div
        className={cn(
          'flex flex-col gap-1',
          rail.compactTimeline && 'max-compact:hidden',
        )}
      >
        {rail.heading === null ? null : (
          <p className={cn('px-3', eyebrowClass)}>{rail.heading}</p>
        )}
        <ol className="flex flex-col gap-1">
          {rail.items.map((item) => (
            <li key={item.id}>
              <Stop item={item} current={item.id === current} />
            </li>
          ))}
        </ol>
      </div>
      <div
        className={cn(
          'flex flex-col gap-1',
          rail.footHeading === null &&
            'mt-auto border-t border-border-strong pt-3',
        )}
      >
        {rail.footHeading === null ? null : (
          <p className={cn('px-3', eyebrowClass)}>{rail.footHeading}</p>
        )}
        <ul
          className={cn(
            'flex flex-col gap-1',
            rail.compactTimeline && 'max-compact:flex-row',
          )}
        >
          {rail.foot.map((item) => (
            <li key={item.id}>
              <Stop item={item} current={item.id === current} />
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
