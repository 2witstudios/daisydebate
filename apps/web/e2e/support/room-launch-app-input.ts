import { systemClock, systemId } from '@daisy/clock';
import type { createApp } from '../../src/server/app';
import { nextWorkerToken } from '../../src/server/worker-token';
import { launchProofPolicy } from './room-launch-policy';
import { betaMessagingPolicy } from '../../src/features/messaging/beta-policy';

type AppInput = Parameters<typeof createApp>[0];
/** The launch proof server's whole app composition, apart from its process env and mail capture. */
export const launchAppInput = (
  env: AppInput['env'],
  fetch: AppInput['fetch'],
): AppInput => ({
  env,
  clock: systemClock,
  ids: systemId,
  fetch,
  roomPolicy: launchProofPolicy,
  messagingPolicy: betaMessagingPolicy,
  nextWorkerToken,
});
