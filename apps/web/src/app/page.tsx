import type { Metadata } from 'next';
import { AppShell } from '../ui/layout/app-shell/app-shell';
import { Dashboard } from '../ui/dashboard/dashboard';
import { OnlineUsers } from '../ui/dashboard/online-users/online-users';
import { TopicCard } from '../ui/dashboard/topic-card/topic-card';
import { ActivityFeed } from '../ui/dashboard/activity-feed/activity-feed';
import { QuoteCard } from '../ui/dashboard/quote-card/quote-card';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

export default function HomePage() {
  return (
    <AppShell
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
