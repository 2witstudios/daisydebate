import {
  messagingTestPosting,
  messagingTestReading,
} from '@daisy/auth/testing';
import type { MessagingRuntimePolicy } from '../../src/features/messaging/composition';
/** Explicit isolated browser proof inputs; never a production policy/default. */
export const messagingBrowserPolicy: MessagingRuntimePolicy = {
  bounds: { messageUnits: 1000, pageItems: 20 },
  maxBodyBytes: 8192,
  editWindowMs: 60000,
  posting: messagingTestPosting,
  reading: messagingTestReading,
  limits: {
    actorSend: { max: 20, windowSeconds: 60 },
    channelSend: { max: 40, windowSeconds: 60 },
    read: { max: 100, windowSeconds: 60 },
  },
  social: {
    bounds: { introductionUnits: 500, titleUnits: 80, batchActors: 10 },
    creation: messagingTestPosting,
    requestLimits: {
      windowMs: 60000,
      maxNewPairs: 10,
      maxPending: 10,
      cooldownMs: 1000,
    },
    abuse: { max: 40, windowSeconds: 60 },
  },
};
