import { createAppError } from '@daisy/errors';
type Previous = {
  readonly inviteeActorId: string;
  readonly generation: number;
  readonly state: string;
  readonly invitedAt: Date;
};
function validateLimits(input: {
  now: string;
  maxMembers: number;
  maxPendingInvitations: number;
}) {
  const time = new Date(input.now).getTime();
  if (
    !Number.isFinite(time) ||
    !Number.isSafeInteger(input.maxMembers) ||
    input.maxMembers < 1 ||
    !Number.isSafeInteger(input.maxPendingInvitations) ||
    input.maxPendingInvitations < 0
  )
    throw createAppError('VALIDATION');
  return time;
}
/** Effect planning only; fresh canonical manager and prospective admission precede this. */
export function planGroupIssuance(input: {
  readonly actorId: string;
  readonly inviteeActorIds: readonly string[];
  readonly activeMemberActorIds: readonly string[];
  readonly previous: readonly Previous[];
  readonly now: string;
  readonly maxMembers: number;
  readonly maxPendingInvitations: number;
}) {
  const time = validateLimits(input);
  const members = new Set(input.activeMemberActorIds);
  const proposed = new Set(input.inviteeActorIds);
  if (
    proposed.size === 0 ||
    proposed.size !== input.inviteeActorIds.length ||
    proposed.has(input.actorId) ||
    [...proposed].some((id) => members.has(id))
  )
    throw createAppError('CONFLICT');
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
    throw createAppError('CONFLICT');
  return input.inviteeActorIds.map((inviteeActorId) => {
    const previous = input.previous.find(
      (row) => row.inviteeActorId === inviteeActorId,
    );
    const generation = (previous?.generation ?? 0) + 1;
    if (
      !Number.isSafeInteger(generation) ||
      generation < 1 ||
      (previous && time < previous.invitedAt.getTime())
    )
      throw createAppError('CONFLICT');
    return {
      inviteeActorId,
      generation,
      expectedGeneration: previous?.generation ?? 0,
    };
  });
}
