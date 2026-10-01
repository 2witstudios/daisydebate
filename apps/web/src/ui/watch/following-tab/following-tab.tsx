import type { Following } from '../../../features/watch/social';
import {
  liveHref,
  replayHref,
  watchRoutes,
} from '../../../features/watch/routes';
import { InertButton } from '../inert-button/inert-button';
import { ActionLink } from '../action-link/action-link';
import { StateCard } from '../state-card/state-card';
import { Avatar } from '../../components/avatar/avatar';

export type FollowingTabProps = {
  /** Null for a signed-out visitor, who has no follows or history. */
  readonly following: Following | null;
  readonly signInHref: string;
};

const card =
  'flex flex-col rounded-lg border border-border bg-surface shadow-1';
const row = 'flex items-center gap-3 border-t border-border px-4 py-3';

/** The viewer's follows and watch history: private to them, never shown to others. */
export function FollowingTab({ following, signInHref }: FollowingTabProps) {
  if (following === null)
    return (
      <StateCard
        icon="users"
        title="Sign in to follow debaters"
        actions={
          <ActionLink href={signInHref} variant="primary">
            Sign in
          </ActionLink>
        }
      >
        <p>
          Who you follow and what you watched are kept for your account. Live
          debates and the archive are open from the other tabs.
        </p>
      </StateCard>
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
        <section aria-label="People you follow" className={card}>
          <h2 className="px-4 py-3 text-xs font-bold tracking-widest text-ink-muted uppercase">
            People you follow
          </h2>
          <ul>
            {following.people.map((person) => (
              <li key={person.handle} className={row}>
                <Avatar name={person.handle} size="md" nameVisible />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-strong text-ink">{`@${person.handle}`}</span>
                  <span className="text-sm text-ink-muted">
                    {person.live
                      ? `Live now in ${person.live.title}`
                      : person.lastDebate}
                  </span>
                </div>
                <ActionLink
                  href={
                    person.live
                      ? liveHref(person.live.id)
                      : watchRoutes.recordings
                  }
                >
                  {person.live ? 'Watch' : 'Recordings'}
                </ActionLink>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Recently watched" className={card}>
          <div className="flex items-center justify-between px-4 py-2">
            <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
              Recently watched
            </h2>
            <InertButton action="clearHistory" variant="ghost">
              Clear history
            </InertButton>
          </div>
          <ul>
            {following.history.map((item) => (
              <li key={item.id} className={row}>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-strong text-ink">
                    {item.title}
                  </span>
                  <span className="text-sm text-ink-muted">{item.note}</span>
                </div>
                <ActionLink href={replayHref(item.id)}>Resume</ActionLink>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="text-sm text-ink-muted">
        Who you follow and what you watched are private to you. Nobody can see
        either, and debaters are never told who watched.
      </p>
    </div>
  );
}
