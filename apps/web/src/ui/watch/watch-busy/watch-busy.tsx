import { ActionLink } from '../action-link/action-link';
import { StateCard } from '../state-card/state-card';

/**
 * Watching refused for now: the audience's share of the database is full, and the
 * debates themselves are unaffected. A real link, so it works without script.
 */
export function WatchBusy({ retryHref }: { readonly retryHref: string }) {
  return (
    <StateCard
      icon="clock"
      level="h1"
      title="A lot of people are watching"
      actions={<ActionLink href={retryHref}>Try again</ActionLink>}
    >
      <p>This page could not load just now. Give it a moment.</p>
    </StateCard>
  );
}
