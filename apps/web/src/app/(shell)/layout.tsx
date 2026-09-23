import { AppShell } from '../../ui/layout/app-shell/app-shell';
import { UiStoreProvider } from '../../ui/store/store';
import { OnlineUsers } from '../../ui/dashboard/online-users/online-users';
import { TopicCard } from '../../ui/dashboard/topic-card/topic-card';
import { ActivityFeed } from '../../ui/dashboard/activity-feed/activity-feed';
import { QuoteCard } from '../../ui/dashboard/quote-card/quote-card';
import { shellAccount } from '../../lib/shell-account';
import { requestIdentity } from '../../lib/request-session';

/**
 * The signed-in product shell: renders AppShell's landmarks once (header,
 * nav, content column, community rail) and resolves the account once per
 * request, so every route in this group inherits the chrome instead of each
 * page composing it for itself. The root layout above keeps only <html>,
 * theme and fonts.
 */
export default async function ShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const identity = await requestIdentity();
  return (
    <UiStoreProvider>
      <AppShell
        account={shellAccount(identity)}
        rail={
          <>
            <OnlineUsers />
            <TopicCard />
            <ActivityFeed />
            <QuoteCard />
          </>
        }
      >
        {children}
      </AppShell>
    </UiStoreProvider>
  );
}
