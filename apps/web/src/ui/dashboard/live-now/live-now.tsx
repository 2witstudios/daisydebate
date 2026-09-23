'use client';

import Link from 'next/link';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Panel } from '../../components/panel/panel';
import { Icon } from '../../components/icon/icon';
import { useUiState } from '../../store/store';
import { Competitor } from './competitor';

export function LiveNow() {
  const liveDebates = useUiState((state) => state.collections.liveDebates);
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <span
            className="size-2 animate-live-pulse rounded-round bg-live motion-reduce:animate-none"
            aria-hidden="true"
          />
          Live Now
        </span>
      }
      action={
        <Link
          href="/watch"
          className={buttonClass('ghost')}
          aria-label="See all live debates"
        >
          See All
        </Link>
      }
    >
      <ul>
        {liveDebates.map((debate) => (
          <li key={debate.topic} className="group">
            <Link
              href="/watch"
              className="flex flex-col gap-3 rounded-sm border-t border-border py-4 no-underline transition-colors duration-140 ease-standard group-first:border-t-0 group-first:pt-1 hover:bg-surface-raised"
            >
              <p className="flex min-w-0 items-center gap-2 text-sm font-bold text-ink">
                <Badge tone="live">Live</Badge>
                <span className="truncate">{debate.topic}</span>
              </p>
              <div className="grid grid-cols-live-matchup items-center gap-3">
                <Competitor
                  side="home"
                  name={debate.challenger}
                  rating={debate.challengerRating}
                />
                <span
                  className="text-xs font-black tracking-wider text-ink-faint uppercase"
                  aria-hidden="true"
                >
                  vs
                </span>
                <Competitor
                  side="away"
                  name={debate.defender}
                  rating={debate.defenderRating}
                />
              </div>
              <p className="flex items-center justify-center gap-2 text-xs text-ink-faint">
                <Icon name="users" size={14} />
                <span className="font-strong text-ink-muted tabular-nums">
                  {debate.viewers}
                </span>
                watching
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
