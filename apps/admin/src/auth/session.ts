import type { OperatorFact } from '../authorization/authorize-operator';
import type { AuditDetail } from '../audit/chain';
import type { AuthDeps } from './attempts';
import { sessionVerdict, type SessionVerdict } from './lifetimes';
import { isSecret, sha3 } from './secrets';
import { auditSession } from './sign-in';
import {
  findOperator,
  findSession,
  revokeSessions,
  touchSession,
} from './store';

/**
 * Every request re-reads its session and the current `operators` row
 * (ADR 0076): expiry is enforced here, server-side, and a disabled
 * operator's session is revoked on the next request it makes.
 */
export const SESSION_COOKIE = 'daisy_admin_session';

export type SignedInOperator = OperatorFact & {
  readonly displayName: string;
  readonly sessionId: string;
};

const revocationDetail: Partial<Record<SessionVerdict, AuditDetail>> = {
  expired: 'session_expired',
  idle: 'session_idle',
  operator_disabled: 'operator_disabled',
};

async function revoke(
  deps: AuthDeps,
  input: { readonly operatorId: string; readonly sessionId: string },
  detail: AuditDetail,
): Promise<void> {
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const revoked = await revokeSessions(tx, {
      operatorId: input.operatorId,
      only: input.sessionId,
      now,
    });
    if (revoked > 0)
      await auditSession(deps, tx, {
        kind: 'session.revoked',
        operatorId: input.operatorId,
        detail,
        now,
      });
  });
}

const iso = (value: Date | null) => value?.toISOString() ?? null;
const verdictOf = (
  session: NonNullable<Awaited<ReturnType<typeof findSession>>>,
  operator: Awaited<ReturnType<typeof findOperator>>,
  now: string,
) =>
  sessionVerdict(
    {
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      revokedAt: iso(session.revokedAt),
    },
    operator && { disabledAt: iso(operator.disabledAt) },
    now,
  );

export async function resolveSession(
  deps: AuthDeps,
  token: string | undefined,
): Promise<SignedInOperator | null> {
  if (!isSecret(token)) return null;
  const session = await findSession(deps.db, sha3(token));
  if (!session) return null;
  const operator = await findOperator(deps.db, session.operatorId);
  const now = deps.clock.now();
  const verdict = verdictOf(session, operator, now);
  const detail = revocationDetail[verdict];
  if (detail) {
    const ids = { operatorId: session.operatorId, sessionId: session.id };
    await revoke(deps, ids, detail);
  }
  if (verdict !== 'active' || !operator) return null;
  await touchSession(deps.db, session.id, now);
  return {
    id: operator.id,
    displayName: operator.displayName,
    role: operator.role as OperatorFact['role'],
    disabled: false,
    revision: operator.revision,
    sessionId: session.id,
  };
}

export async function signOut(
  deps: AuthDeps,
  token: string | undefined,
): Promise<void> {
  if (!isSecret(token)) return;
  const session = await findSession(deps.db, sha3(token));
  if (session)
    await revoke(
      deps,
      { operatorId: session.operatorId, sessionId: session.id },
      'signed_out',
    );
}
