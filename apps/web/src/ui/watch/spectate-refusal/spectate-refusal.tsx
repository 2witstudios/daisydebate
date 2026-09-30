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
          <p>
            Live rooms need an account so chat stays accountable and debaters
            can be protected.
          </p>
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
        >
          <p>
            It may be private, it may have been removed, or the link may be
            wrong. Daisy does not say which, so private debates stay private.
          </p>
        </StateCard>
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
        >
          <p>
            You are seated in it or assigned to judge it. To keep the round
            fair, debaters and judges never watch their own debate as
            spectators.
          </p>
        </StateCard>
      );
    case 'revoked':
      return (
        <StateCard
          icon="alert"
          level="h1"
          title="You can no longer watch this debate"
          actions={backToLive('See live debates')}
        >
          <p>
            The host changed who can watch it, so your access ended. Nothing you
            posted in chat is shown any more. Other public debates are still
            live.
          </p>
        </StateCard>
      );
    case 'full':
      return (
        <StateCard
          icon="users"
          level="h1"
          title="This debate is full of spectators"
          actions={backToLive('Back to live debates')}
        >
          <p>
            It has reached its limit of [N] spectators. Try again in a moment,
            or watch the recording once it ends. Debaters are never affected.
          </p>
        </StateCard>
      );
    case 'upcoming':
      return (
        <StateCard
          icon="clock"
          level="h1"
          title="This debate has not started"
          actions={backToLive('See live debates')}
        >
          <p>
            {`${screen.title} begins when both debaters are ready. Stay on this page and you will be taken in as soon as it starts. Spectators join about 30 seconds behind the debaters.`}
          </p>
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
