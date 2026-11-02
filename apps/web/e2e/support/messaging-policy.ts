import { isolatedMessagingPolicy } from '../../src/features/messaging/isolated-policy.test-support';

/**
 * Explicit isolated browser proof inputs; never a production policy/default.
 * Text and body sizes are the DEC-124 beta limits themselves.
 */
const base = isolatedMessagingPolicy();
export const messagingBrowserPolicy = isolatedMessagingPolicy({
  // Real sends can fill more than the 50-row live window in one journey.
  limits: { ...base.limits, actorSend: [{ max: 60, windowSeconds: 60 }] },
});
