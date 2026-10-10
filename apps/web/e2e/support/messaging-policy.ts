import {
  messagingTestPosting,
  messagingTestGroupPolicy,
  messagingTestGroupReading,
  messagingTestReading,
} from '@daisy/auth/testing';
import type { MessagingRuntimePolicy } from '../../src/features/messaging/composition';
/** Explicit isolated browser proof inputs; never a production policy/default. */
export const messagingBrowserPolicy: MessagingRuntimePolicy = {
  reactions: { reactionUnits: 8, choices: ['👍', '❤️'] },
  typing: { ttlMs: 6000, refetchMs: 1000, maxActors: 12 },
  bounds: { messageUnits: 1000, pageItems: 20 },
  maxBodyBytes: 8192,
  editWindowMs: 60000,
  posting: messagingTestPosting,
  groupPosting: messagingTestGroupPolicy,
  reading: (input) =>
    input.channel.authority.kind === 'private_group'
      ? messagingTestGroupReading(input)
      : messagingTestReading(input),
  limits: {
    actorSend: { max: 20, windowSeconds: 60 },
    channelSend: { max: 40, windowSeconds: 60 },
    read: { max: 100, windowSeconds: 60 },
  },
  social: {
    bounds: { introductionUnits: 500, titleUnits: 80, batchActors: 10 },
    creation: messagingTestPosting,
    groupAdmission: messagingTestGroupPolicy,
    groupInvitationLimits: { maxMembers: 12, maxPendingInvitations: 10 },
    requestLimits: {
      windowMs: 60000,
      maxNewPairs: 10,
      maxPending: 10,
      cooldownMs: 1000,
    },
    abuse: { max: 40, windowSeconds: 60 },
  },
};
