import { watchRoutes } from '../../../features/watch/routes';
import { ActionLink } from '../action-link/action-link';
import { StateCard } from '../state-card/state-card';

/**
 * Opening a Round that has no audience: one answer whether it is private or
 * missing, so a copied link learns nothing about which.
 */
export function SpectateRefusal() {
  return (
    <StateCard
      icon="alert"
      level="h1"
      title="This debate is not available"
      actions={
        <>
          <ActionLink href={watchRoutes.hub}>See live debates</ActionLink>
          <ActionLink href={watchRoutes.recordings} variant="ghost">
            Browse recordings
          </ActionLink>
        </>
      }
    />
  );
}
