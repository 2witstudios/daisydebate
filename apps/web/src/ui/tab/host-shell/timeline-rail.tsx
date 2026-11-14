import Link from 'next/link';
import {
  standingLabel,
  type RailItem,
  type TimelineRail as Rail,
} from '../../../features/tab/tournament';
import { cn } from '../../cn';
import { SampleAction } from '../../components/sample-action/sample-action';
import { eyebrowClass } from '../list-card/list-card';

const stopClass = 'flex justify-between gap-3 rounded-sm px-3 py-2';

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
  if (item.action.href === null)
    return (
      <SampleAction
        label={item.action.label}
        className={cn(stopClass, 'text-ink')}
      >
        {face}
      </SampleAction>
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
      <Link href="/" className="px-3 font-strong text-ink underline">
        Back to Daisy
      </Link>
      <div className="flex flex-col px-3">
        <strong className="font-display text-xl font-bold">{rail.title}</strong>
        {rail.subtitle === null ? null : (
          <span className="text-sm text-ink-muted">{rail.subtitle}</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
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
        <ul className="flex flex-col gap-1">
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
