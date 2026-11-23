import { tryInstantMs } from '@daisy/clock/instant';
type Previous = {
  readonly inviteeActorId: string;
  readonly generation: number;
  readonly state: string;
  readonly invitedAt: Date;
};
/** Why a plan cannot apply; the store refuses with this code and writes nothing. */
export type GroupPlanRefusal = { readonly refused: 'CONFLICT' | 'VALIDATION' };
const refused = (code: GroupPlanRefusal['refused']): GroupPlanRefusal => ({
  refused: code,
});

function validateLimits(input: {
  now: string;
  maxMembers: number;
  maxPendingInvitations: number;
}) {
  const time = tryInstantMs(input.now);
  if (
    time === undefined ||
    !Number.isSafeInteger(input.maxMembers) ||
    input.maxMembers < 1 ||
    !Number.isSafeInteger(input.maxPendingInvitations) ||
    input.maxPendingInvitations < 0
  )
    return undefined;
  return time;
}
/**
 * Effect planning only; fresh canonical manager and prospective admission
 * precede this. The store applies it to the members and invitations it read
 * under the channel's FOR UPDATE locks.
 */
export function planGroupIssuance(input: {
  readonly actorId: string;
  readonly inviteeActorIds: readonly string[];
  readonly activeMemberActorIds: readonly string[];
  readonly previous: readonly Previous[];
  readonly now: string;
  readonly maxMembers: number;
  readonly maxPendingInvitations: number;
}):
  | readonly {
      readonly inviteeActorId: string;
      readonly generation: number;
      readonly expectedGeneration: number;
    }[]
  | GroupPlanRefusal {
  const time = validateLimits(input);
  if (time === undefined) return refused('VALIDATION');
  const members = new Set(input.activeMemberActorIds);
  const proposed = new Set(input.inviteeActorIds);
  if (
    proposed.size === 0 ||
    proposed.size !== input.inviteeActorIds.length ||
    proposed.has(input.actorId) ||
    [...proposed].some((id) => members.has(id))
  )
    return refused('CONFLICT');
  const pending = input.previous.filter((row) => row.state === 'pending');
  if (
    pending.some((row) => proposed.has(row.inviteeActorId)) ||
    pending.length + proposed.size > input.maxPendingInvitations ||
    new Set([
      ...members,
      ...pending.map((row) => row.inviteeActorId),
      ...proposed,
    ]).size > input.maxMembers
  )
    return refused('CONFLICT');
  const plan = input.inviteeActorIds.map((inviteeActorId) => {
    const previous = input.previous.find(
      (row) => row.inviteeActorId === inviteeActorId,
    );
    const generation = (previous?.generation ?? 0) + 1;
    if (
      !Number.isSafeInteger(generation) ||
      generation < 1 ||
      (previous && time < previous.invitedAt.getTime())
    )
      return null;
    return {
      inviteeActorId,
      generation,
      expectedGeneration: previous?.generation ?? 0,
    };
  });
  return plan.every((invitation) => invitation !== null)
    ? plan
    : refused('CONFLICT');
}
