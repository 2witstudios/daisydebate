'use client';

import { Button } from '../components/button/button';
import { useRef, type ReactNode } from 'react';
import { Avatar } from '../components/avatar/avatar';
import { profilePhotoSrc } from '../profile/photo-src';
import { publicNameLabel } from '../profile/public-name';
import { statusLabels } from '../components/presence-dot/status-labels';
import { Icon } from '../components/icon/icon';
import { cn } from '../cn';
import type { PeopleRailPreference } from '../layout/app-shell/rail-preference';
import { ChallengeCards, FollowAccepted } from '../challenges/challenge-cards';
import { ratingsLabel } from './member-card';
import { usePeople } from './people-provider';
import { PersonList, usePersonOverlay } from './people-rows';
import type { PersonActions } from './person-actions';

const fullClass: Readonly<Record<PeopleRailPreference, string>> = {
  open: 'people-full-open',
  mini: 'hidden',
  auto: 'people-full-auto',
};
const miniClass: Readonly<Record<PeopleRailPreference, string>> = {
  open: 'people-mini-open',
  mini: 'flex',
  auto: 'people-mini-auto',
};

/** The list's search and tabs, shared with the phone's view. */
function PeopleControls() {
  const { query, setQuery, filter, setFilter, list } = usePeople();
  return (
    <>
      <label className="flex">
        <span className="sr-only">Search people</span>
        <input
          type="search"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-10 w-full min-w-0 rounded-md border border-border bg-surface-raised px-3 text-sm text-ink hover:border-border-strong"
        />
      </label>
      <div role="group" aria-label="Show" className="flex gap-1">
        <Button
          variant="filter"
          type="button"
          aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          All
          <span className="font-book text-ink-faint tabular-nums">
            {list.counts.everyone}
          </span>
        </Button>
        <Button
          variant="filter"
          type="button"
          aria-pressed={filter === 'friends'}
          onClick={() => setFilter('friends')}
        >
          Friends
          <span className="font-book text-ink-faint tabular-nums">
            {list.counts.friends}
          </span>
        </Button>
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
      <Button
        variant="icon"
        type="submit"
        aria-label={label}
        title={label}
        size="nav"
      >
        <Icon name="panelRight" size={20} />
      </Button>
    </form>
  );
}

/**
 * Your card, then everyone, on every page (ADR 0105): open beside the page,
 * or collapsed to avatars with yours first, then friends. Below 1101px it stays collapsed and on a phone it
 * gives way to the Lobby's People view. Filling the whole column keeps it flush
 * to the right edge, mirroring the left rail.
 */
export function PeopleRail({
  preference,
  actions,
  setRail,
  activeRoomId,
  selfCard,
  selfMini,
}: {
  readonly preference: PeopleRailPreference;
  readonly actions: PersonActions;
  readonly setRail: (form: FormData) => Promise<void>;
  readonly activeRoomId: string | null;
  /** Your own card, above everyone; its avatar alone in the mini rail. */
  readonly selfCard?: ReactNode;
  readonly selfMini?: ReactNode;
}) {
  const { list } = usePeople();
  const aside = useRef<HTMLElement>(null);
  const overlay = usePersonOverlay(aside, actions);
  const friends = list.people.filter((m) => m.relation === 'friends');
  const others = list.people.filter((m) => m.relation !== 'friends');
  return (
    <aside
      ref={aside}
      aria-label="People"
      className="sticky top-0 z-10 h-dvh self-start border-l border-border bg-surface area-people max-narrow:hidden"
    >
      <div className={cn('h-full flex-col', fullClass[preference])}>
        {selfCard ? <div className="mx-2 mt-2">{selfCard}</div> : null}
        <ChallengeCards
          actions={actions}
          activeRoomId={activeRoomId}
          className="mx-2 mt-2"
        />
        <div className="flex flex-col gap-2 border-b border-border px-3 pt-2 pb-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-baseline gap-1 text-sm font-semibold text-ink-muted">
              People
              <span className="font-book tabular-nums">
                · {list.counts.online} online
              </span>
            </h2>
            <RailToggle
              to="mini"
              action={setRail}
              label="Collapse people list"
            />
          </div>
          <PeopleControls />
        </div>
        <PersonList overlay={overlay} className="min-h-0 flex-1 pb-1" />
      </div>
      <div
        className={cn(
          'h-full flex-col items-center gap-1 py-2',
          miniClass[preference],
        )}
      >
        {selfMini}
        <RailToggle to="open" action={setRail} label="Expand people list" />
        <p className="text-xs font-bold text-online">
          <span className="sr-only">Online </span>
          {list.counts.online}
        </p>
        <ul className="flex min-h-0 w-full flex-1 list-none flex-col items-center overflow-y-auto">
          {[...friends, ...others].map((member, index) => (
            <li key={member.username}>
              {index === friends.length && friends.length > 0 ? (
                <hr className="mx-auto my-1 w-8 border-border" />
              ) : null}
              <Button
                variant="icon"
                {...overlay.rowProps(member.username)}
                type="button"
                onClick={(event) =>
                  overlay.open(member.username, event.currentTarget)
                }
                aria-haspopup="dialog"
                aria-label={`${publicNameLabel(member)}, ${statusLabels[member.status]}, ${ratingsLabel(member)}`}
                size="nav"
                aria-expanded={overlay.menuName === member.username}
              >
                <Avatar
                  name={member.displayName ?? member.username}
                  src={profilePhotoSrc(member.photoId, 128)}
                  presence={member.status}
                  size="sm"
                  nameVisible
                />
              </Button>
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
      <FollowAccepted activeRoomId={activeRoomId} />
    </aside>
  );
}

/**
 * The phone's people list, in the Lobby, with the same menu as a sheet. Its
 * challenge cards sit on every page through `PhoneChallengeCards`.
 */
export function PeoplePanel({ actions }: { readonly actions: PersonActions }) {
  const panel = useRef<HTMLElement>(null);
  const overlay = usePersonOverlay(panel, actions);
  return (
    <section
      ref={panel}
      aria-label="People"
      className="relative flex flex-col gap-3"
    >
      <PeopleControls />
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
