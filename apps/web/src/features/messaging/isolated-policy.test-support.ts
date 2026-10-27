import {
  messagingTestGroupPolicy,
  messagingTestGroupReading,
  messagingTestPosting,
  messagingTestReading,
} from '@daisy/auth/testing';
import { messagingBetaLimits } from '@daisy/protocol';
import { dec251MessagingValues } from './beta-policy';
import type { MessagingRuntimePolicy } from './composition';

/**
 * The explicit isolated-fixture messaging policy: test posting and reading,
 * private groups opted in, DEC-251 request budgets and roomy rate windows.
 * Never a production policy or default; suites override what they pin.
 */
export const isolatedMessagingPolicy = (
  overrides: Partial<MessagingRuntimePolicy> = {},
): MessagingRuntimePolicy => ({
  reactions: { reactionUnits: 8, choices: ['👍', '❤️'], distinctPerMessage: 2 },
  typing: { ttlMs: 6000, refetchMs: 1000, maxActors: 12 },
  bounds: { messageUnits: messagingBetaLimits.messageUnits, pageItems: 20 },
  maxBodyBytes: messagingBetaLimits.bodyBytes,
  editWindowMs: 60000,
  posting: messagingTestPosting,
  privateGroups: 'isolated-test-fixture',
  groupPosting: messagingTestGroupPolicy,
  reading: (input) =>
    input.channel.authority.kind === 'private_group'
      ? messagingTestGroupReading(input)
      : messagingTestReading(input),
  limits: {
    actorSend: [{ max: 20, windowSeconds: 60 }],
    read: [{ max: 100, windowSeconds: 60 }],
    reactions: [{ max: 60, windowSeconds: 60 }],
    typing: [{ max: 30, windowSeconds: 60 }],
    fileUploadsDaily: dec251MessagingValues.fileUploadsDaily,
    fileBytes: dec251MessagingValues.fileBytes,
  },
  social: {
    bounds: {
      introductionUnits: messagingBetaLimits.introductionUnits,
      titleUnits: messagingBetaLimits.titleUnits,
      batchActors: 10,
    },
    creation: messagingTestPosting,
    groupAdmission: messagingTestGroupPolicy,
    groupInvitationLimits: { maxMembers: 12, maxPendingInvitations: 10 },
    requests: dec251MessagingValues.socialRequests,
    abuse: [{ max: 40, windowSeconds: 60 }],
  },
  ...overrides,
});
