import { tryInstantMs } from '@daisy/clock/instant';
import type { GroupPlanRefusal } from './group-issuance-plan';

export type GroupManagementOperation =
  'remove' | 'leave' | 'transfer' | 'archive';
type Grant = {
  readonly actorId: string;
  readonly role: 'manager' | 'member';
  readonly generation: number;
  readonly grantedAt: Date;
};
type GrantChange = {
  readonly actorId: string;
  readonly expectedGeneration: number;
  readonly generation: number;
  readonly role: Grant['role'];
  readonly revokedAt: Date | null;
};
/** A grant's next generation; null when its stored generation cannot advance. */
function changeGrant(
  grant: Grant,
  role: Grant['role'],
  revokedAt: Date | null,
): GrantChange | null {
  const generation = grant.generation + 1;
  if (!Number.isSafeInteger(generation) || grant.generation < 1) return null;
  return {
    actorId: grant.actorId,
    expectedGeneration: grant.generation,
    generation,
    role,
    revokedAt,
  };
}

const changes = (
  planned: readonly (GrantChange | null)[],
): readonly GrantChange[] | null =>
  planned.every((change) => change !== null) ? planned : null;

function removalPlan(
  operation: 'remove' | 'leave',
  actorId: string,
  targetActorId: string | undefined,
  lifecycle: 'active' | 'archived',
  grants: readonly Grant[],
  now: Date,
): readonly GrantChange[] | null {
  if (operation === 'remove' && actorId === targetActorId) return null;
  const target = grants.find(
    (g) => g.actorId === (operation === 'leave' ? actorId : targetActorId),
  );
  if (!target) return null;
  if (
    lifecycle === 'active' &&
    target.role === 'manager' &&
    grants.filter((g) => g.role === 'manager').length === 1
  )
    return null;
  return changes([changeGrant(target, target.role, now)]);
}

function transferPlan(
  actorId: string,
  targetActorId: string | undefined,
  grants: readonly Grant[],
): readonly GrantChange[] | null {
  const current = grants.find((g) => g.actorId === actorId),
    target = grants.find((g) => g.actorId === targetActorId);
  if (
    !current ||
    current.role !== 'manager' ||
    !target ||
    current.actorId === target.actorId ||
    target.role !== 'member'
  )
    return null;
  return changes([
    changeGrant(current, 'member', null),
    changeGrant(target, 'manager', null),
  ]);
}

/**
 * Effect invariants only. The caller must already hold the canonical
 * authority fence; the store applies the plan to the grants it read under the
 * channel's FOR UPDATE lock, or refuses with nothing written.
 */
export function planGroupManagement(input: {
  readonly operation: GroupManagementOperation;
  readonly actorId: string;
  readonly targetActorId?: string;
  readonly lifecycle: 'active' | 'archived';
  readonly grants: readonly Grant[];
  readonly now: string;
}):
  | {
      readonly lifecycle: 'active' | 'archived';
      readonly changes: readonly GrantChange[];
    }
  | GroupPlanRefusal {
  const conflict: GroupPlanRefusal = { refused: 'CONFLICT' };
  const nowMs = tryInstantMs(input.now) ?? Number.NaN;
  if (
    !Number.isFinite(nowMs) ||
    input.grants.some(
      (g) =>
        !Number.isFinite(g.grantedAt.getTime()) ||
        nowMs < g.grantedAt.getTime(),
    )
  )
    return conflict;
  const now = new Date(nowMs);
  if (input.operation === 'archive' || input.operation === 'transfer') {
    if (input.lifecycle !== 'active') return conflict;
    if (input.operation === 'archive')
      return { lifecycle: 'archived', changes: [] };
    const transfer = transferPlan(
      input.actorId,
      input.targetActorId,
      input.grants,
    );
    return transfer ? { lifecycle: 'active', changes: transfer } : conflict;
  }
  const removal = removalPlan(
    input.operation,
    input.actorId,
    input.targetActorId,
    input.lifecycle,
    input.grants,
    now,
  );
  return removal ? { lifecycle: input.lifecycle, changes: removal } : conflict;
}
