import { featureWork, type ProcessWork } from '../../server/feature-work';
import type { Waits } from '@daisy/clock';
import type { App } from '../../server/app';
import { startRoundMediaRecovery } from './recovery-worker';
import { mediaConfigured } from '../round-runtime/worker-policy';
import { readPublicCheckInProbe } from '../availability/configuration';
import { createRoundMediaRuntime, stopRoundMedia } from './composition';
import { recoveryFailureFields } from './recovery-failure';

const processRuntimes = new WeakMap<
  App,
  ReturnType<typeof createRoundMediaRuntime> | null
>();

/**
 * This process's one round media runtime for its background work (media
 * recovery and the bot seats); null when media is not configured.
 */
export const processRoundMedia = (app: App, waits: Waits) => {
  if (!processRuntimes.has(app))
    processRuntimes.set(
      app,
      mediaConfigured(app.config) ? createRoundMediaRuntime(app, waits) : null,
    );
  return processRuntimes.get(app) ?? null;
};

/** Round media's background work: session recovery and the node probes. */
export const startRoundMediaWork = ({ app, waits, wakes }: ProcessWork) => {
  const mediaRuntime = processRoundMedia(app, waits);
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
    mediaRuntime,
    // The node probes: this process's media runtime and the routes'.
    roundMedia: { stop: () => stopRoundMedia(app) },
  });
};
