'use client';

import { useRef } from 'react';
import { Avatar } from '../components/avatar/avatar';
import { statusLabels } from '../components/presence-dot/status-labels';
import { Icon } from '../components/icon/icon';
import { cn } from '../cn';
import type { OnlineRailPreference } from '../layout/app-shell/rail-preference';
import { ChallengeCards } from './challenge-cards';
import { ratingsLabel } from './member-card';
import { useOnline } from './online-provider';
import { PersonList, usePersonOverlay } from './online-rows';
import type { PersonActions } from './person-actions';

const fullClass: Readonly<Record<OnlineRailPreference, string>> = {
  open: 'online-full-open',
  mini: 'hidden',
  auto: 'online-full-auto',
};
const miniClass: Readonly<Record<OnlineRailPreference, string>> = {
  open: 'online-mini-open',
  mini: 'flex',
  auto: 'online-mini-auto',
};

const tab =
  'inline-flex min-h-10 items-center gap-1.5 rounded-sm px-3 text-sm font-semibold text-ink-muted hover:bg-surface-overlay hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-ink';

/** The list's search and tabs, shared with the phone's Online view. */
function OnlineControls() {
  const { query, setQuery, filter, setFilter, roster } = useOnline();
  return (
    <>
      <label className="flex">
        <span className="sr-only">Search people online</span>
        <input
          type="search"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-10 w-full min-w-0 rounded-md border border-border bg-surface-raised px-3 text-sm text-ink hover:border-border-strong"
        />
      </label>
      <div role="group" aria-label="Show" className="flex gap-1">
        <button
          type="button"
          aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
          className={tab}
        >
          All{' '}
          <span className="font-book text-ink-faint">
            {roster.counts.everyone}
          </span>
        </button>
        <button
          type="button"
          aria-pressed={filter === 'friends'}
          onClick={() => setFilter('friends')}
          className={tab}
        >
          Friends{' '}
          <span className="font-book text-ink-faint">
            {roster.counts.friends}
          </span>
        </button>
      </div>
    </>
  );
}

function RailToggle({
  to,
  action,
  label,
}: {
  readonly to: 'open' | 'mini';
  readonly action: (form: FormData) => Promise<void>;
  readonly label: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="rail" value={to} />
      <button
        type="submit"
        aria-label={label}
        title={label}
        className="flex size-nav-target items-center justify-center rounded-sm text-ink-muted hover:bg-surface-overlay hover:text-ink"
      >
        <Icon name="panelRight" size={20} />
      </button>
    </form>
  );
}

/**
 * Who's online, on every page (ADR 0097): open beside the page, or collapsed to
 * avatars with friends first. Below 1101px it stays collapsed and on a phone it
 * gives way to the Lobby's Online view. Filling the whole column keeps it flush
 * to the right edge, mirroring the left rail.
 */
export function OnlineRail({
  preference,
  actions,
  setRail,
  activeRoomId,
}: {
  readonly preference: OnlineRailPreference;
  readonly actions: PersonActions;
  readonly setRail: (form: FormData) => Promise<void>;
  readonly activeRoomId: string | null;
}) {
  const { roster } = useOnline();
  const aside = useRef<HTMLElement>(null);
  const overlay = usePersonOverlay(aside, actions);
  const friends = roster.members.filter((m) => m.relation === 'friends');
  const others = roster.members.filter((m) => m.relation !== 'friends');
  return (
    <aside
      ref={aside}
      aria-label="Who's online"
      className="sticky top-0 z-10 h-dvh self-start border-l border-border bg-surface area-online max-narrow:hidden"
    >
      <div className={cn('h-full flex-col', fullClass[preference])}>
        <ChallengeCards
          actions={actions}
          activeRoomId={activeRoomId}
          className="mx-2 mt-2"
        />
        <div className="flex flex-col gap-2 border-b border-border px-3 pt-3 pb-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-baseline gap-2 font-display text-xl leading-tight font-semibold">
              Online{' '}
              <span className="text-sm font-semibold text-ink-muted">
                {roster.counts.everyone}
              </span>
            </h2>
            <RailToggle
              to="mini"
              action={setRail}
              label="Collapse online list"
            />
          </div>
          <OnlineControls />
        </div>
        <PersonList overlay={overlay} className="min-h-0 flex-1 pb-1" />
      </div>
      <div
        className={cn(
          'h-full flex-col items-center gap-1 py-2',
          miniClass[preference],
        )}
      >
        <RailToggle to="open" action={setRail} label="Expand online list" />
        <p className="text-xs font-bold text-online">
          <span className="sr-only">Online </span>
          {roster.counts.everyone}
        </p>
        <ul className="flex min-h-0 w-full flex-1 list-none flex-col items-center overflow-y-auto">
          {[...friends, ...others].map((member, index) => (
            <li key={member.username}>
              {index === friends.length && friends.length > 0 ? (
                <hr className="mx-auto my-1 w-8 border-border" />
              ) : null}
              <button
                type="button"
                {...overlay.rowProps(member.username)}
                onClick={(event) =>
                  overlay.open(member.username, event.currentTarget)
                }
                aria-haspopup="menu"
                aria-label={`@${member.username}, ${statusLabels[member.status]}, ${ratingsLabel(member)}`}
                className={cn(
                  'flex size-nav-target items-center justify-center rounded-md hover:bg-surface-overlay',
                  overlay.menuName === member.username && 'bg-surface-overlay',
                )}
              >
                <Avatar
                  name={member.username}
                  presence={member.status}
                  size="sm"
                  nameVisible
                />
              </button>
            </li>
          ))}
        </ul>
        <div className="absolute top-2 right-full z-20 mr-2 w-person-card empty:hidden">
          <ChallengeCards
            actions={actions}
            activeRoomId={activeRoomId}
            cardClassName="shadow-3"
          />
        </div>
      </div>
      {overlay.overlay}
    </aside>
  );
}

/**
 * The phone's Online view, in the Lobby, with the same menu as a sheet. Its
 * challenge cards sit on every page through `PhoneChallengeCards`.
 */
export function OnlinePanel({ actions }: { readonly actions: PersonActions }) {
  const panel = useRef<HTMLElement>(null);
  const overlay = usePersonOverlay(panel, actions);
  return (
    <section
      ref={panel}
      aria-label="Who's online"
      className="relative flex flex-col gap-3"
    >
      <OnlineControls />
      <PersonList overlay={overlay} className="-mx-4" />
      {overlay.overlay}
    </section>
  );
}

/** A phone has no rail, so its challenge card floats above the tabs on any page. */
export function PhoneChallengeCards({
  actions,
  activeRoomId,
}: {
  readonly actions: PersonActions;
  readonly activeRoomId: string | null;
}) {
  return (
    <div className="fixed inset-x-2 more-sheet z-30 hidden max-h-fit max-narrow:block">
      <ChallengeCards
        actions={actions}
        activeRoomId={activeRoomId}
        cardClassName="shadow-3"
      />
    </div>
  );
}
