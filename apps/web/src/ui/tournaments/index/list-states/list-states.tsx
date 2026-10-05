'use client';

import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../../components/icon/icon';
import { buttonClass } from '../../../components/button/button-class';
import { LinkButton } from '../../link-button/link-button';
import { InertAction } from '../../inert-action/inert-action';
import { tournamentRoutes } from '../../../../features/tournaments/routes';

function StateCard({
  icon,
  title,
  children,
  live,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly children: ReactNode;
  /** Announce the state to assistive tech as it appears. */
  readonly live?: 'status' | 'alert';
}) {
  return (
    <div className="flex flex-col items-center gap-3 border-t border-border px-5 py-8 text-center">
      <span className="text-ink-faint">
        <Icon name={icon} size={28} />
      </span>
      <p role={live} className="text-md font-strong text-ink">
        {title}
      </p>
      {children}
    </div>
  );
}

/** While the list loads: three rows of placeholders. */
export function ListSkeleton() {
  return (
    <div className="border-t border-border" aria-busy="true">
      <span role="status" className="sr-only">
        Loading tournaments
      </span>
      <ul aria-hidden="true">
        {[0, 1, 2].map((key) => (
          <li
            key={key}
            className="flex items-center justify-between gap-6 border-t border-border px-5 py-4 first:border-t-0"
          >
            <div className="flex w-1/2 flex-col gap-2">
              <span className="block h-4 w-1/3 rounded-sm bg-surface-overlay" />
              <span className="block h-3 w-1/4 rounded-sm bg-surface-overlay" />
            </div>
            <span className="block h-10 w-16 rounded-sm bg-surface-overlay" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A tab with nothing in it and no filters set. */
export function NothingOpen() {
  return (
    <StateCard icon="trophy" title="No open tournaments">
      <div className="flex flex-wrap justify-center gap-3">
        <InertAction id="notifyNew" />
        <LinkButton href={tournamentRoutes.create}>
          Create a tournament
        </LinkButton>
      </div>
    </StateCard>
  );
}

/** Filters that match nothing. */
export function NoMatches({ clearHref }: { readonly clearHref: string }) {
  return (
    <StateCard icon="search" title="No matches">
      <LinkButton href={clearHref}>Clear filters</LinkButton>
    </StateCard>
  );
}

/** The list could not be read. `retry` re-runs the route segment. */
export function LoadFailed({ retry }: { readonly retry: () => void }) {
  return (
    <StateCard icon="alert" title="Tournaments did not load" live="alert">
      <button type="button" onClick={retry} className={buttonClass('primary')}>
        Try again
      </button>
    </StateCard>
  );
}
