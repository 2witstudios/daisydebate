import type { ReplayScreen } from '../../../features/watch/open-replay';
import { watchRoutes } from '../../../features/watch/routes';
import { ActionLink } from '../action-link/action-link';
import { SpectateRefusal } from '../spectate-refusal/spectate-refusal';
import { StateCard } from '../state-card/state-card';

export type ReplayRefusalProps = {
  readonly screen: Exclude<ReplayScreen, { kind: 'watch' }>;
};

/** A recording that cannot be replayed: not available, being prepared or expired. */
export function ReplayRefusal({ screen }: ReplayRefusalProps) {
  if (screen.kind === 'unavailable')
    return <SpectateRefusal screen={{ kind: 'unavailable' }} />;
  if (screen.kind === 'processing')
    return (
      <StateCard
        icon="clock"
        level="h1"
        title="The replay is being prepared"
        actions={
          <ActionLink href={watchRoutes.recordings}>
            Back to recordings
          </ActionLink>
        }
      >
        <p>
          Recordings are ready a few minutes after a debate ends. The transcript
          and timeline will appear here, and the result follows once every
          ballot is in.
        </p>
      </StateCard>
    );
  return (
    <StateCard
      icon="alert"
      level="h1"
      title="This recording is no longer kept"
      actions={
        <ActionLink href={watchRoutes.recordings}>Browse recordings</ActionLink>
      }
    >
      <p>
        Recordings are deleted after [N] days under the retention policy. The
        result and the rating change stay on the ladder.
      </p>
    </StateCard>
  );
}
