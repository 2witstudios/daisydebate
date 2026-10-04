import type { SpectateScreen } from '../../../features/watch/open-spectate';
import { watchRoutes } from '../../../features/watch/routes';
import { ActionLink } from '../action-link/action-link';
import { StateCard } from '../state-card/state-card';

export type SpectateRefusalProps = {
  readonly screen: Exclude<SpectateScreen, { kind: 'watch' }>;
};

const backToLive = (label: string) => (
  <ActionLink href={watchRoutes.hub}>{label}</ActionLink>
);

/**
 * Every way opening a live debate can end without a view: signed out, not
 * available, seated or judging, removed by the host, full, not started yet.
 */
export function SpectateRefusal({ screen }: SpectateRefusalProps) {
  switch (screen.kind) {
    case 'signed-out':
      return (
        <StateCard
          icon="eye"
          level="h1"
          title="Sign in to watch live debates"
          actions={
            <>
              <ActionLink href={screen.signInHref} variant="primary">
                Sign in
              </ActionLink>
              {backToLive('See live debates')}
            </>
          }
        >
          {screen.teaser ? (
            <p className="rounded-md bg-surface-overlay p-3 text-sm">
              <span className="font-strong text-live">Live</span>{' '}
              <b className="text-ink">{screen.teaser.title}</b>
              {`, ${screen.teaser.modeLabel}, ${screen.teaser.watching} watching`}
            </p>
          ) : null}
        </StateCard>
      );
    case 'unavailable':
      return (
        <StateCard
          icon="alert"
          level="h1"
          title="This debate is not available"
          actions={
            <>
              {backToLive('See live debates')}
              <ActionLink href={watchRoutes.recordings} variant="ghost">
                Browse recordings
              </ActionLink>
            </>
          }
        />
      );
    case 'conflict':
      return (
        <StateCard
          icon="gavel"
          level="h1"
          title="You cannot spectate this debate"
          actions={
            <>
              <ActionLink href={screen.yourDebateHref} variant="primary">
                Go to your debate
              </ActionLink>
              {backToLive('Back to live debates')}
            </>
          }
        />
      );
    case 'revoked':
      return (
        <StateCard
          icon="alert"
          level="h1"
          title="You can no longer watch this debate"
          actions={backToLive('See live debates')}
        />
      );
    case 'full':
      return (
        <StateCard
          icon="users"
          level="h1"
          title="This debate is full of spectators"
          actions={backToLive('Back to live debates')}
        />
      );
    case 'upcoming':
      return (
        <StateCard
          icon="clock"
          level="h1"
          title="This debate has not started"
          actions={backToLive('See live debates')}
        >
          <p>{screen.title}</p>
          <ul className="mt-2 flex flex-col gap-2 text-left">
            {screen.seats.map((seat) => (
              <li
                key={seat.label}
                className="flex items-center justify-between gap-4 rounded-md bg-surface-overlay p-3 text-sm"
              >
                <span className="text-ink">
                  <b>{`@${seat.handle}`}</b>
                  {` ${seat.label}, ${seat.rating}`}
                </span>
                <span className="text-ink-muted">
                  {seat.ready ? 'Ready' : 'Seating up'}
                </span>
              </li>
            ))}
          </ul>
        </StateCard>
      );
  }
}
