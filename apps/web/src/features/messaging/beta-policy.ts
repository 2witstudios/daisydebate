import { socialMemberReading } from '@daisy/auth/social-reading';
import type { SocialContactPolicy } from '@daisy/auth/social-policy';
import type { MessagingPolicyOverride } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { messagingBetaLimits } from '@daisy/protocol';
import type { RateRule } from '../auth/abuse/rate-limit';
import type { MessagingRuntimePolicy } from './composition';

type Windows = readonly RateRule[];

/** The numbers a deployment may tighten; every other policy field is fixed in code. */
export type MessagingBetaValues = {
  readonly editWindowMs: number;
  readonly send: Windows;
  readonly read: Windows;
  readonly reactions: {
    readonly windows: Windows;
    readonly distinctPerMessage: number;
  };
  readonly typing: Windows;
  readonly socialRequests: {
    readonly daily: number;
    readonly unrelatedHourly: number;
    readonly declinesToBlock: number;
    readonly declineBlockMs: number;
  };
  readonly fileUploadsDaily: number;
  /** Bytes per attachment; fixed by DEC-251, never overridden. */
  readonly fileBytes: number;
};

const freeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object')
    for (const field of Object.values(value)) freeze(field);
  return Object.freeze(value);
};

const DAY_SECONDS = 86_400;

/**
 * DEC-251, the beta messaging policy, as one frozen value: it composes the
 * shipped policy and is the floor any override is checked against.
 */
export const dec251MessagingValues: MessagingBetaValues = freeze({
  editWindowMs: 15 * 60_000,
  send: [
    { max: 10, windowSeconds: 10 },
    { max: 30, windowSeconds: 60 },
    { max: 600, windowSeconds: 3_600 },
  ],
  read: [{ max: 120, windowSeconds: 60 }],
  reactions: {
    windows: [{ max: 60, windowSeconds: 60 }],
    distinctPerMessage: 10,
  },
  // One signal per 3 s; a signal expires after 6 s (typingTtlMs).
  typing: [{ max: 1, windowSeconds: 3 }],
  socialRequests: {
    daily: 20,
    unrelatedHourly: 5,
    declinesToBlock: 3,
    declineBlockMs: 30 * DAY_SECONDS * 1_000,
  },
  fileUploadsDaily: 20,
  fileBytes: 10_000_000,
});

const refuse = (field: string): never => {
  throw createAppError(
    'VALIDATION',
    `MESSAGING_POLICY.${field} would loosen DEC-251`,
  );
};

const atMost = (field: string, floor: number, value: number | undefined) =>
  value === undefined ? floor : value <= floor ? value : refuse(field);
const atLeast = (field: string, floor: number, value: number | undefined) =>
  value === undefined ? floor : value >= floor ? value : refuse(field);

/** The same window lengths, each allowing no more than the floor's. */
const tighterWindows = (
  field: string,
  floor: Windows,
  value: Windows | undefined,
): Windows => {
  if (value === undefined) return floor;
  if (value.length !== floor.length) return refuse(field);
  return floor.map((rule) => {
    const next = value.find((row) => row.windowSeconds === rule.windowSeconds);
    return next
      ? { ...rule, max: atMost(field, rule.max, next.max) }
      : refuse(field);
  });
};

/**
 * Applies a deployment's overrides to `floor`. Each may only tighten: a
 * looser value refuses the whole policy at boot, naming its field, and is
 * never clamped.
 */
export function tightenMessagingValues(
  floor: MessagingBetaValues,
  override: MessagingPolicyOverride | undefined,
): MessagingBetaValues {
  if (override === undefined) return floor;
  const requests = override.socialRequests ?? {};
  return freeze({
    editWindowMs: atMost(
      'editWindowMs',
      floor.editWindowMs,
      override.editWindowMs,
    ),
    send: tighterWindows('send', floor.send, override.send),
    read: tighterWindows('read', floor.read, override.read),
    reactions: {
      windows: tighterWindows(
        'reactions.windows',
        floor.reactions.windows,
        override.reactions?.windows,
      ),
      distinctPerMessage: atMost(
        'reactions.distinctPerMessage',
        floor.reactions.distinctPerMessage,
        override.reactions?.distinctPerMessage,
      ),
    },
    typing: tighterWindows('typing', floor.typing, override.typing),
    socialRequests: {
      daily: atMost(
        'socialRequests.daily',
        floor.socialRequests.daily,
        requests.daily,
      ),
      unrelatedHourly: atMost(
        'socialRequests.unrelatedHourly',
        floor.socialRequests.unrelatedHourly,
        requests.unrelatedHourly,
      ),
      declinesToBlock: atMost(
        'socialRequests.declinesToBlock',
        floor.socialRequests.declinesToBlock,
        requests.declinesToBlock,
      ),
      declineBlockMs: atLeast(
        'socialRequests.declineBlockMs',
        floor.socialRequests.declineBlockMs,
        requests.declineBlockMs,
      ),
    },
    fileUploadsDaily: atMost(
      'fileUploadsDaily',
      floor.fileUploadsDaily,
      override.fileUploadsDaily,
    ),
    fileBytes: floor.fileBytes,
  });
}

/**
 * DEC-251 posting: admitted (beta approved) participants aged 16 or over,
 * within one age band. ADR 0061 allows no cross-band contact without a
 * separately approved guardian policy, so 16-17 and adult never meet.
 */
const betaDmPolicy = {
  state: 'approved',
  decision: 'DEC-251',
  key: 'social.dm',
  revision: 1,
  allowedBandPairs: [
    ['adult', 'adult'],
    ['16-17', '16-17'],
  ],
} as const satisfies SocialContactPolicy;

/**
 * Beta defaults DEC-251 leaves open, approved by the orchestrator [749] and
 * recorded on the DEC-251 page: this reaction set, 8-unit reactions, typing
 * refetched every 3 s for at most 2 actors (DMs only while groups are off),
 * and no per-channel send window.
 */
const reactionChoices = ['👍', '❤️', '😂', '😮', '😢', '👏'];

/**
 * The beta messaging policy every deployed app runs. Private groups (DEC-127)
 * compose no group posting or admission, so every group entry point refuses.
 */
function composeBetaMessagingPolicy(
  values: MessagingBetaValues,
): MessagingRuntimePolicy {
  return {
    reactions: {
      reactionUnits: 8,
      choices: reactionChoices,
      distinctPerMessage: values.reactions.distinctPerMessage,
    },
    typing: { ttlMs: 6_000, refetchMs: 3_000, maxActors: 2 },
    bounds: {
      messageUnits: messagingBetaLimits.messageUnits,
      pageItems: messagingBetaLimits.pageItems,
    },
    maxBodyBytes: messagingBetaLimits.bodyBytes,
    editWindowMs: values.editWindowMs,
    posting: betaDmPolicy,
    privateGroups: 'off',
    reading: socialMemberReading(betaDmPolicy),
    limits: {
      actorSend: values.send,
      read: values.read,
      reactions: values.reactions.windows,
      typing: values.typing,
      fileUploadsDaily: values.fileUploadsDaily,
      fileBytes: values.fileBytes,
    },
    social: {
      bounds: {
        introductionUnits: messagingBetaLimits.introductionUnits,
        titleUnits: messagingBetaLimits.titleUnits,
        batchActors: messagingBetaLimits.batchActors,
      },
      creation: betaDmPolicy,
      requests: values.socialRequests,
      // Decisions and blocks share the per-account send ceiling.
      abuse: values.send,
    },
  };
}

/** The tightenable numbers a composed policy carries. */
const valuesOf = (policy: MessagingRuntimePolicy): MessagingBetaValues => ({
  editWindowMs: policy.editWindowMs,
  send: policy.limits.actorSend,
  read: policy.limits.read,
  reactions: {
    windows: policy.limits.reactions,
    distinctPerMessage: policy.reactions.distinctPerMessage,
  },
  typing: policy.limits.typing,
  socialRequests: policy.social.requests,
  fileUploadsDaily: policy.limits.fileUploadsDaily,
  fileBytes: policy.limits.fileBytes,
});

/**
 * The policy an app runs: `policy` with the deployment's overrides, each
 * checked against `policy`'s own value (so the shipped DEC-251 policy is its
 * own floor).
 */
export function tightenMessagingPolicy(
  policy: MessagingRuntimePolicy,
  override: MessagingPolicyOverride | undefined,
): MessagingRuntimePolicy {
  if (override === undefined) return policy;
  const values = tightenMessagingValues(valuesOf(policy), override);
  return {
    ...policy,
    editWindowMs: values.editWindowMs,
    reactions: {
      ...policy.reactions,
      distinctPerMessage: values.reactions.distinctPerMessage,
    },
    limits: {
      actorSend: values.send,
      read: values.read,
      reactions: values.reactions.windows,
      typing: values.typing,
      fileUploadsDaily: values.fileUploadsDaily,
      fileBytes: values.fileBytes,
    },
    social: { ...policy.social, requests: values.socialRequests },
  };
}

/** The policy every deployed app runs (process-app.ts). */
export const betaMessagingPolicy = composeBetaMessagingPolicy(
  dec251MessagingValues,
);
