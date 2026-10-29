import type { ReactNode } from 'react';
import { ActiveRoomBar } from '../../active-room/active-room-bar';
import type { ActiveRoomSummary } from '../../active-room/your-room';
import { cn } from '../../cn';
import type { ShellAccount } from './account';
import type { RailPreference } from './rail-preference';
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
  /** The server action the rail's toggle form posts to flip that choice. */
  readonly toggleRail: () => Promise<void>;
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
  toggleRail,
}: AppShellProps) {
  return (
    <div
      className={cn(
        'grid min-h-screen grid-shell items-start bg-background',
        rail === 'extended' && 'grid-shell-extended',
      )}
    >
      <Rail account={account} rail={rail} toggleRail={toggleRail} />
      <main className="min-w-0 area-main">
        {account.state === 'member' ? (
          <ActiveRoomBar room={activeRoom} />
        ) : null}
        {children}
      </main>
      <TabBar account={account} />
    </div>
  );
}
