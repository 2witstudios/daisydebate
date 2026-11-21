import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { decideBetaAccessChange } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { loadAuthorizationAccount } from '../authorization';
import { insertPendingBetaAccess } from '../beta-access';
import { writeBetaAccessChange } from '../beta-access-change';
import { lockOpenAccount } from '../lock-open-account';
import { childAccountRequests, guardianLinks } from '../schema/guardian-links';
import { users } from '../schema/users';
import { scopeTransaction } from '../tenant-scope';
import type { Tx } from '../tx';

type GuardianClaimTx = Pick<Tx, 'select' | 'insert' | 'update' | 'execute'>;

async function findRequest(tx: GuardianClaimTx, userId: string, at: Date) {
  const [request] = await tx
    .select({
      id: childAccountRequests.id,
      guardianUserId: childAccountRequests.guardianUserId,
      guardianConsentId: childAccountRequests.guardianConsentId,
      birthMonth: childAccountRequests.birthMonth,
      firstName: childAccountRequests.firstName,
      createdAt: childAccountRequests.createdAt,
    })
    .from(childAccountRequests)
    .innerJoin(users, eq(users.email, childAccountRequests.email))
    .where(
      and(
        eq(users.id, userId),
        eq(users.emailVerified, true),
        isNull(users.username),
        isNull(users.deletedAt),
        gt(users.createdAt, childAccountRequests.createdAt),
        eq(childAccountRequests.status, 'open'),
        gt(childAccountRequests.expiresAt, at),
      ),
    )
    .orderBy(asc(childAccountRequests.createdAt), asc(childAccountRequests.id))
    .limit(1);
  if (!request?.birthMonth || !request.firstName) return null;
  const guardian = await loadAuthorizationAccount(tx, request.guardianUserId);
  if (
    !guardian?.member ||
    guardian.erased ||
    guardian.restricted ||
    guardian.ageBand !== 'adult'
  )
    return null;
  return {
    ...request,
    birthMonth: request.birthMonth,
    firstName: request.firstName,
  };
}

export async function readChildAccountRequest(
  tx: GuardianClaimTx,
  userId: string,
  at: Date,
) {
  await scopeTransaction(tx, { subjectUserId: userId });
  return findRequest(tx, userId, at);
}

/** The parent and child are fenced in the same user-id order as account mutations. */
export async function lockChildAccountRequest(
  tx: GuardianClaimTx,
  userId: string,
  at: Date,
) {
  const before = await readChildAccountRequest(tx, userId, at);
  if (before === null) {
    await lockOpenAccount(tx, userId);
    if (await findRequest(tx, userId, at)) throw createAppError('VALIDATION');
    return null;
  }
  for (const id of [userId, before.guardianUserId].sort())
    await lockOpenAccount(tx, id);
  const request = await findRequest(tx, userId, at);
  if (!request || request.id !== before.id) throw createAppError('VALIDATION');
  return request;
}

/** Caller holds both account fences and just recorded the binding birth month. */
export async function claimChildAccount(
  tx: GuardianClaimTx,
  request: NonNullable<Awaited<ReturnType<typeof findRequest>>>,
  childUserId: string,
  ids: { readonly linkId: string; readonly pendingBetaEventId: string },
  at: Date,
) {
  const [claimed] = await tx
    .update(childAccountRequests)
    .set({
      status: 'claimed',
      claimedUserId: childUserId,
      closedAt: at,
      email: null,
      firstName: null,
      birthMonth: null,
    })
    .where(
      and(
        eq(childAccountRequests.id, request.id),
        eq(childAccountRequests.status, 'open'),
      ),
    )
    .returning({ id: childAccountRequests.id });
  if (!claimed) throw createAppError('VALIDATION');
  await tx.insert(guardianLinks).values({
    id: ids.linkId,
    guardianUserId: request.guardianUserId,
    guardianConsentId: request.guardianConsentId,
    minorUserId: childUserId,
    status: 'active',
    activation: 'created-account',
    activatedAt: at,
    createdAt: at,
    updatedAt: at,
  });
  await tx
    .update(users)
    .set({ name: request.firstName, updatedAt: at })
    .where(eq(users.id, childUserId));
  const parent = await loadAuthorizationAccount(tx, request.guardianUserId);
  if (
    parent?.beta?.state !== 'approved' ||
    parent.restricted ||
    parent.ageBand !== 'adult'
  )
    return;
  await insertPendingBetaAccess(tx, childUserId, () => ids.pendingBetaEventId);
  const child = await loadAuthorizationAccount(tx, childUserId);
  const change = decideBetaAccessChange({
    current: child?.beta ?? null,
    desired: 'approved',
    expectedRevision: child?.beta?.revision ?? 0,
    ageAdmitted: true,
  });
  if (
    child &&
    !child.erased &&
    !child.restricted &&
    change.kind === 'changed'
  ) {
    await writeBetaAccessChange(tx, {
      userId: childUserId,
      change,
      eventId: request.id,
      commandId: null,
      principal: 'signup',
    });
  }
}
