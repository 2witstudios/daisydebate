import { type GuardianLinkRow } from '@daisy/db/stores/guardians';
import { createAppError } from '@daisy/errors';
import type { GuardianLink } from './guardian-link';

export function readGuardianLink(row: GuardianLinkRow): GuardianLink {
  const {
    id,
    guardianUserId,
    minorUserId,
    guardianConsentId,
    version,
    status,
  } = row;
  const base = { id, guardianUserId, minorUserId, guardianConsentId, version };
  if (status === 'requested') return { ...base, status };
  if (status === 'refused' || status === 'cancelled') {
    if (row.closedAt)
      return { ...base, status, closedAt: row.closedAt.toISOString() };
    throw createAppError('INVARIANT');
  }
  const activation =
    row.activation === 'created-account'
      ? ({ kind: row.activation } as const)
      : row.activation === 'child-confirmed' && row.childConfirmationId
        ? ({
            kind: row.activation,
            childConfirmationId: row.childConfirmationId,
          } as const)
        : null;
  if (!activation || !row.activatedAt) throw createAppError('INVARIANT');
  const active = {
    ...base,
    activation,
    activatedAt: row.activatedAt.toISOString(),
  };
  if (status === 'active') return { ...active, status };
  if (!row.closedAt) throw createAppError('INVARIANT');
  return { ...active, status, closedAt: row.closedAt.toISOString() };
}

export function linkStateColumns(link: GuardianLink, now: Date) {
  return {
    status: link.status,
    activation: 'activation' in link ? link.activation.kind : null,
    activatedAt: 'activatedAt' in link ? new Date(link.activatedAt) : null,
    childConfirmationId:
      'activation' in link && link.activation.kind === 'child-confirmed'
        ? link.activation.childConfirmationId
        : null,
    closedAt: 'closedAt' in link ? new Date(link.closedAt) : null,
    version: link.version,
    updatedAt: now,
  };
}
