import { Suspense } from 'react';
import { SampleActionNotice } from '../../ui/components/sample-action/sample-action-notice';
import { AppShell } from '../../ui/layout/app-shell/app-shell';
import { UiStoreProvider } from '../../ui/store/store';
import { shellAccount } from '../../lib/shell-account';
import { requestIdentity } from '../../lib/request-session';
import { requestActiveRoom } from './active-room';
import { ActiveRoomBar } from '../../ui/rooms/active-room/active-room-bar';

/**
 * The signed-in product shell: renders AppShell's landmarks once (header,
 * nav, topic banner, content column, presence dock) and resolves the account once per
 * request, so every route in this group inherits the chrome instead of each
 * page composing it for itself. The root layout above keeps only <html>,
 * theme and fonts. The sample-action banner sits above every page: a control
 * with no backend answers with it on the same page. A member's active
 * Room (ADR 0070) shows its way back on every page but its own.
 */
export default async function ShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const identity = await requestIdentity();
  const activeRoom =
    identity.state === 'member' ? await requestActiveRoom() : null;
  return (
    <UiStoreProvider>
      <AppShell account={shellAccount(identity)}>
        <Suspense fallback={null}>
          <SampleActionNotice />
        </Suspense>
        <ActiveRoomBar activeRoom={activeRoom} />
        {children}
      </AppShell>
    </UiStoreProvider>
  );
}
