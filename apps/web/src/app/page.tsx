import type { Metadata } from 'next';
import { AppShell } from '../ui/layout/app-shell/app-shell';
import { Dashboard } from '../ui/dashboard/dashboard';
import { OnlineUsers } from '../ui/dashboard/online-users/online-users';
import { TopicCard } from '../ui/dashboard/topic-card/topic-card';
import { ActivityFeed } from '../ui/dashboard/activity-feed/activity-feed';
import { QuoteCard } from '../ui/dashboard/quote-card/quote-card';
import { shellAccount } from '../lib/shell-account';
import { requestIdentity } from '../lib/request-session';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

export default async function HomePage() {
  const identity = await requestIdentity();
  return (
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
      <Dashboard />
    </AppShell>
  );
}
