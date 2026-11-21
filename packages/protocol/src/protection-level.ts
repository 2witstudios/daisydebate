import { z } from 'zod';
import type { MessageRequestSetting } from './messaging/social';
import type { AgeBand } from './ladder';

export const protectionLevels = [
  'independent',
  'guided',
  'supervised',
  'custom',
] as const;

export const friendApprovalLimits = ['none', 'inbound-adult', 'all'] as const;
type FriendApprovalLimit = (typeof friendApprovalLimits)[number];

export const protectionLevelSchema = z.discriminatedUnion('level', [
  z.strictObject({ level: z.literal('independent') }),
  z.strictObject({ level: z.literal('guided') }),
  z.strictObject({ level: z.literal('supervised') }),
  z.strictObject({
    level: z.literal('custom'),
    friendApproval: z.enum(friendApprovalLimits),
    friendsOnlyMessages: z.boolean(),
    rankedAllowed: z.boolean(),
  }),
]);

export type ProtectionLevel = z.infer<typeof protectionLevelSchema>;

export type ProtectionLimits = {
  readonly friendApproval: FriendApprovalLimit;
  readonly messageRequests: Extract<MessageRequestSetting, 'friends'> | null;
  readonly rankedAllowed: boolean;
};

const presets = {
  independent: {
    friendApproval: 'none',
    messageRequests: null,
    rankedAllowed: true,
  },
  guided: {
    friendApproval: 'inbound-adult',
    messageRequests: null,
    rankedAllowed: true,
  },
  supervised: {
    friendApproval: 'all',
    messageRequests: 'friends',
    rankedAllowed: false,
  },
} as const satisfies Record<
  Exclude<ProtectionLevel['level'], 'custom'>,
  ProtectionLimits
>;

export function protectionLimits(choice: ProtectionLevel): ProtectionLimits {
  if (choice.level !== 'custom') return presets[choice.level];
  return {
    friendApproval: choice.friendApproval,
    messageRequests: choice.friendsOnlyMessages ? 'friends' : null,
    rankedAllowed: choice.rankedAllowed,
  };
}

function friendRequestNeedsGuardian(
  limits: ProtectionLimits,
  direction: 'incoming' | 'outgoing',
  otherAge: AgeBand | null,
): boolean {
  return (
    limits.friendApproval === 'all' ||
    (limits.friendApproval === 'inbound-adult' &&
      direction === 'incoming' &&
      (otherAge === 'adult' || otherAge === null))
  );
}

/** Every protected endpoint has its own guardian decision on this request. */
export function friendRequestState(
  members: readonly {
    readonly actorId: string;
    readonly limits: ProtectionLimits;
    readonly direction: 'incoming' | 'outgoing';
    readonly otherAge: AgeBand | null;
    readonly cleared: boolean;
  }[],
) {
  const holds = members
    .filter(
      ({ limits, direction, otherAge, cleared }) =>
        !cleared && friendRequestNeedsGuardian(limits, direction, otherAge),
    )
    .map(({ actorId }) => actorId);
  return {
    state: holds.length ? 'waiting-for-guardian' : 'pending',
    holds,
  } as const;
}
