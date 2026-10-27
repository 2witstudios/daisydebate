import { isolatedMessagingPolicy } from '../../src/features/messaging/isolated-policy.test-support';

/**
 * Explicit isolated browser proof inputs; never a production policy/default.
 * Text and body sizes are the DEC-124 beta limits themselves.
 */
export const messagingBrowserPolicy = isolatedMessagingPolicy();
