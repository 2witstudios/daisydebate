'use client';

import Link from 'next/link';
import { Icon } from '../../../../components/icon/icon';
import { useUiState } from '../../../../store/store';

/**
 * Today's topic as a slim line under the navbar: what it is, and a way in.
 * It scrolls away with the page instead of living in a column of its own.
 */
export function TopicBanner() {
  const topic = useUiState((state) => state.resources.todaysTopic);
  return (
    <aside
      aria-label="Today's topic"
      className="flex min-w-0 items-center gap-4 border-b border-border bg-surface-raised px-6 py-2 text-sm area-banner max-compact:gap-3 max-compact:px-4"
    >
      <span className="flex shrink-0 items-center gap-2 text-xs font-bold tracking-widest text-accent uppercase max-compact:hidden">
        <Icon name="message" size={14} />
        Today&rsquo;s topic
      </span>
      <span className="min-w-0 flex-1 truncate font-strong text-ink">
        {topic}
      </span>
      <Link href="/play" className="shrink-0 font-strong">
        Join the discussion
      </Link>
    </aside>
  );
}
