import type { ReactNode } from 'react';
import { ActiveRoomBar } from '../../active-room/active-room-bar';
import type { ActiveRoomSummary } from '../../active-room/your-room';
import { cn } from '../../cn';
import type { ShellAccount, ShellRatings } from './account';
import type { PeopleRailPreference, RailPreference } from './rail-preference';
import { Rail } from './components/rail/rail';
import { TabBar } from './components/tab-bar/tab-bar';

export type AppShellProps = {
  /** Main content column. */
  readonly children: ReactNode;
  /** Who is signed in: a member gets their own places, a visitor a way in. */
  readonly account: ShellAccount;
  /** The viewer's one active Room: a bar above every page leads back to it. */
  readonly activeRoom: ActiveRoomSummary | null;
  /** The viewer's saved rail width, resolved per request (ADR 0091). */
  readonly rail: RailPreference;
  /** A member's ratings for the account menu, still reading; null for anyone else. */
  readonly ratings: Promise<ShellRatings> | null;
  /** The server action the rail's toggle form posts to flip that choice. */
  readonly toggleRail: () => Promise<void>;
  /** The member's own status control, already wired to its action. */
  readonly statusControl?: ReactNode;
  /** The people rail and its provider's other parts; absent for a visitor. */
  readonly people?: {
    readonly preference: PeopleRailPreference;
    readonly rail: ReactNode;
    readonly wrap: (shell: ReactNode) => ReactNode;
  } | null;
};

const peopleColumn: Readonly<Record<PeopleRailPreference, string>> = {
  open: 'grid-shell-people-open',
  mini: 'grid-shell-people-mini',
  auto: 'grid-shell-people-auto',
};

/**
 * Full-viewport chrome: one navigation rail beside the page — extended,
 * with words beside the icons, unless the viewer minimized it to the
 * icon-only rail (a cookie the server reads per request, so the first HTML
 * carries the right width) — or on a phone a tab bar along the bottom. Owns
 * interior layout only; content owns its own appearance. This component
 * owns the page's single <main> landmark: the root layout renders no
 * landmark of its own. Both navigations are in the markup and the layout
 * shows one, so the shell is right before any script runs.
 */
export function AppShell({
  children,
  account,
  activeRoom,
  rail,
  ratings,
  toggleRail,
  statusControl,
  people,
}: AppShellProps) {
  const shell = (
    <div
      className={cn(
        'grid min-h-screen grid-shell items-start bg-background',
        rail === 'extended' && 'grid-shell-extended',
        people && peopleColumn[people.preference],
      )}
    >
      <Rail
        account={account}
        rail={rail}
        ratings={ratings}
        toggleRail={toggleRail}
        statusControl={statusControl}
      />
      <main className="min-w-0 area-main">
        {account.state === 'member' ? (
          <ActiveRoomBar room={activeRoom} />
        ) : null}
        {children}
      </main>
      {people?.rail}
      <TabBar account={account} statusControl={statusControl} />
    </div>
  );
  return people ? people.wrap(shell) : shell;
}
