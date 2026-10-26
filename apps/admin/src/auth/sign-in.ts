import { eq } from 'drizzle-orm';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { appendAudit } from '../audit/store';
import type { AuditDetail } from '../audit/chain';
import type { AdminTransaction } from '../db/client';
import { operatorCredentials, operatorSessions } from '../db/schema';
import {
  rateLimited,
  refuse,
  type Attempt,
  type AuthDeps,
  type Refusal,
} from './attempts';
import { counterAccepted } from './counter';
import { challengeExpiry, sessionExpiry } from './lifetimes';
import {
  isSecret,
  mintSecret,
  sha3,
  SECRET_BYTES,
  toBase64Url,
} from './secrets';
import {
  consumeChallenge,
  findActiveCredential,
  findSession,
  insertChallenge,
  revokeSessions,
} from './store';
import {
  authenticationOptions,
  responseChallenge,
  verifyAuthentication,
} from './webauthn';

/**
 * Passkey sign-in (ADR 0076): a discoverable-credential assertion with user
 * verification, a single-use challenge consumed before verification, the
 * sign counter rule, and a fresh session that replaces any presented one.
 */
const signInAttempt = (address: string): Attempt => ({
  purpose: 'sign-in',
  address,
});

export async function beginSignIn(
  deps: AuthDeps,
  input: { readonly address: string },
): Promise<
  | Refusal
  | {
      readonly ok: true;
      readonly options: PublicKeyCredentialRequestOptionsJSON;
    }
> {
  const limited = await rateLimited(deps, signInAttempt(input.address));
  if (limited) return limited;
  const now = deps.clock.now();
  const bytes = deps.random(SECRET_BYTES);
  await insertChallenge(deps.db, {
    id: deps.ids.next(),
    purpose: 'authenticate',
    enrollmentId: null,
    challengeHash: sha3(toBase64Url(bytes)),
    now,
    expiresAt: challengeExpiry(now),
  });
  return { ok: true, options: await authenticationOptions(bytes) };
}

export const auditSession = (
  deps: AuthDeps,
  tx: AdminTransaction,
  input: {
    readonly kind: 'auth.success' | 'session.revoked';
    readonly operatorId: string;
    readonly detail: AuditDetail | null;
    readonly now: string;
  },
) =>
  appendAudit(tx, {
    id: deps.ids.next(),
    kind: input.kind,
    operatorId: input.operatorId,
    commandId: null,
    targetUserId: null,
    outcome: null,
    detail: input.detail,
    at: input.now,
  });

/** Rotation: the presented session (if any) dies with the new one's birth. */
async function openSession(
  deps: AuthDeps,
  input: {
    readonly credentialRowId: string;
    readonly operatorId: string;
    readonly counter: number;
    readonly presented: string | null;
    readonly now: string;
  },
): Promise<string> {
  const { operatorId, now } = input;
  const token = mintSecret(deps.random);
  const previous = isSecret(input.presented)
    ? await findSession(deps.db, sha3(input.presented))
    : null;
  await deps.db.transaction(async (tx) => {
    await tx
      .update(operatorCredentials)
      .set({ signCount: input.counter })
      .where(eq(operatorCredentials.id, input.credentialRowId));
    if (
      previous &&
      (await revokeSessions(tx, {
        operatorId: previous.operatorId,
        only: previous.id,
        now,
      })) > 0
    )
      await auditSession(deps, tx, {
        kind: 'session.revoked',
        operatorId: previous.operatorId,
        detail: 'rotated',
        now,
      });
    await tx.insert(operatorSessions).values({
      id: deps.ids.next(),
      operatorId,
      tokenHash: sha3(token),
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: new Date(sessionExpiry(now)),
    });
    await auditSession(deps, tx, {
      kind: 'auth.success',
      operatorId,
      detail: null,
      now,
    });
  });
  return token;
}

/** Consumes the answered challenge first: a replay finds nothing to use. */
async function consumedChallenge(
  deps: AuthDeps,
  response: AuthenticationResponseJSON,
  now: string,
): Promise<string | null> {
  const challenge = responseChallenge(response.response.clientDataJSON);
  if (!isSecret(challenge)) return null;
  const consumed = await consumeChallenge(deps.db, {
    challengeHash: sha3(challenge),
    purpose: 'authenticate',
    enrollmentId: null,
    now,
  });
  return consumed ? challenge : null;
}

export async function finishSignIn(
  deps: AuthDeps,
  input: {
    readonly address: string;
    readonly response: AuthenticationResponseJSON;
    readonly presented: string | null;
  },
): Promise<Refusal | { readonly ok: true; readonly sessionToken: string }> {
  const attempt = signInAttempt(input.address);
  const limited = await rateLimited(deps, attempt);
  if (limited) return limited;
  const now = deps.clock.now();
  const challenge = await consumedChallenge(deps, input.response, now);
  if (!challenge) return refuse(deps, attempt, 'challenge_invalid');
  const found = await findActiveCredential(deps.db, input.response.id);
  if (!found) return refuse(deps, attempt, 'credential_unknown');
  const { credential, operator } = found;
  if (operator.disabledAt !== null)
    return refuse(deps, attempt, 'operator_disabled', operator.id);
  const verified = await verifyAuthentication({
    response: input.response,
    challenge,
    credential,
    ceremony: deps.ceremony,
  });
  if (!verified)
    return refuse(deps, attempt, 'verification_failed', operator.id);
  const counter = { stored: credential.signCount, received: verified.counter };
  // The registered backup state decides: an assertion cannot opt itself out.
  if (!counterAccepted({ ...counter, backedUp: credential.backedUp }))
    return refuse(deps, attempt, 'counter_regressed', operator.id);
  const sessionToken = await openSession(deps, {
    credentialRowId: credential.id,
    operatorId: operator.id,
    counter: Math.max(counter.stored, counter.received),
    presented: input.presented,
    now,
  });
  return { ok: true, sessionToken };
}
