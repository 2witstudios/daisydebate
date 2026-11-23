import { featureWork } from '../../server/feature-work';
import type { ProcessWork } from '../../server/process-work';
import { startRoundMediaRecovery } from './recovery-worker';
import { readPublicCheckInProbe } from '../availability/configuration';
import { stopRoundMedia } from './composition';
import { recoveryFailureFields } from './recovery-failure';

/** Round media's background work: session recovery and the node probes. */
export const startRoundMediaWork = ({
  app,
  waits,
  wakes,
  media: mediaRuntime,
}: ProcessWork) => {
  return featureWork({
    mediaRecovery: mediaRuntime
      ? startRoundMediaRecovery({
          recover: (listed) =>
            mediaRuntime.operations().recoverActiveSessions(listed),
          failed: (error) =>
            app.logger.log(
              'round.media.recovery_failed',
              {
                operation: 'round.media.recovery',
                errorCode: 'INFRASTRUCTURE',
                ...recoveryFailureFields(error),
              },
              'Media recovery remains pending',
            ),
          waits,
          wake: wakes.of('round'),
          probeRoundId:
            readPublicCheckInProbe(
              app.config.ATTENDANCE_PUBLIC_PROBE,
              app.config.PUBLIC_APP_URL,
            )?.roundId ?? null,
        })
      : null,
    // The node probes of every round media runtime the routes composed.
    roundMedia: { stop: () => stopRoundMedia(app) },
  });
};
