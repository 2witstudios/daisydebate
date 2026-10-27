import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { appendAudit } from '../audit/store';
import {
  authorizeOperator,
  currentApprovalPolicy,
  type OperatorAction,
} from '../authorization/authorize-operator';
import { sameOrigin } from '../auth/origin';
import {
  resolveSession,
  SESSION_COOKIE,
  type SignedInOperator,
} from '../auth/session';
import { PEER_HEADER } from './gate';
import { adminRuntime } from './runtime';

/** The peer the admin server recorded for this request. */
export async function requestPeer(): Promise<string> {
  return (await headers()).get(PEER_HEADER) ?? 'unknown';
}

/** Every server action's CSRF check against the canonical origin. */
export async function requireSameOrigin(): Promise<void> {
  if (!sameOrigin((await headers()).get('origin')))
    throw new Error('Cross-origin action refused');
}

export async function currentOperator(): Promise<SignedInOperator | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(adminRuntime().auth, token);
}

/**
 * Pages call this first: no live session goes to sign-in, and an operator
 * the evaluator denies is audited and shown nothing.
 */
export async function requireOperator(
  action: OperatorAction,
): Promise<{ readonly operator: SignedInOperator; readonly allowed: boolean }> {
  const operator = await currentOperator();
  if (!operator) redirect('/sign-in');
  const decision = authorizeOperator({
    operator,
    action,
    policy: currentApprovalPolicy,
  });
  if (decision.allowed) return { operator, allowed: true };
  const { auth } = adminRuntime();
  await auth.db.transaction((tx) =>
    appendAudit(tx, {
      id: auth.ids.next(),
      kind: 'access.denied',
      operatorId: operator.id,
      commandId: null,
      targetUserId: null,
      outcome: null,
      detail:
        decision.reason === 'disabled' ? 'operator_disabled' : decision.reason,
      at: auth.clock.now(),
    }),
  );
  return { operator, allowed: false };
}
