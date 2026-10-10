import { createAppError } from '@daisy/errors';

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
const conflict = () => {
  throw createAppError('CONFLICT');
};

function changeGrant(
  grant: Grant,
  role: Grant['role'],
  revokedAt: Date | null,
): GrantChange {
  const generation = grant.generation + 1;
  if (!Number.isSafeInteger(generation) || grant.generation < 1) conflict();
  return {
    actorId: grant.actorId,
    expectedGeneration: grant.generation,
    generation,
    role,
    revokedAt,
  };
}

function removalPlan(
  operation: 'remove' | 'leave',
  actorId: string,
  targetActorId: string | undefined,
  lifecycle: 'active' | 'archived',
  grants: readonly Grant[],
  now: Date,
) {
  if (operation === 'remove' && actorId === targetActorId) conflict();
  const target = grants.find(
    (g) => g.actorId === (operation === 'leave' ? actorId : targetActorId),
  );
  if (!target) return conflict();
  if (
    lifecycle === 'active' &&
    target.role === 'manager' &&
    grants.filter((g) => g.role === 'manager').length === 1
  )
    conflict();
  return [changeGrant(target, target.role, now)];
}

function transferPlan(
  actorId: string,
  targetActorId: string | undefined,
  grants: readonly Grant[],
) {
  const current = grants.find((g) => g.actorId === actorId),
    target = grants.find((g) => g.actorId === targetActorId);
  if (
    !current ||
    current.role !== 'manager' ||
    !target ||
    current.actorId === target.actorId ||
    target.role !== 'member'
  )
    return conflict();
  return [
    changeGrant(current, 'member', null),
    changeGrant(target, 'manager', null),
  ];
}

/** Effect invariants only. The caller must already hold the canonical authority fence. */
export function planGroupManagement(input: {
  readonly operation: GroupManagementOperation;
  readonly actorId: string;
  readonly targetActorId?: string;
  readonly lifecycle: 'active' | 'archived';
  readonly grants: readonly Grant[];
  readonly now: string;
}): {
  readonly lifecycle: 'active' | 'archived';
  readonly changes: readonly GrantChange[];
} {
  const now = new Date(input.now);
  if (
    !Number.isFinite(now.getTime()) ||
    input.grants.some(
      (g) => !Number.isFinite(g.grantedAt.getTime()) || now < g.grantedAt,
    )
  )
    conflict();
  if (input.operation === 'archive' || input.operation === 'transfer') {
    if (input.lifecycle !== 'active') conflict();
    return input.operation === 'archive'
      ? { lifecycle: 'archived', changes: [] }
      : {
          lifecycle: 'active',
          changes: transferPlan(
            input.actorId,
            input.targetActorId,
            input.grants,
          ),
        };
  }
  return {
    lifecycle: input.lifecycle,
    changes: removalPlan(
      input.operation,
      input.actorId,
      input.targetActorId,
      input.lifecycle,
      input.grants,
      now,
    ),
  };
}
