import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { appendAudit } from '../audit/store';
import type { AdminTransaction } from '../db/client';
import { operatorCredentials } from '../db/schema';
import {
  isUniqueViolation,
  refuse,
  releaseAttempt,
  reserveAttempt,
  type Attempt,
  type AuthDeps,
  type Refusal,
} from './attempts';
import { challengeExpiry } from './lifetimes';
import { isSecret, sha3, SECRET_BYTES, toBase64Url } from './secrets';
import {
  activeCredentials,
  consumeChallenge,
  consumeEnrollment,
  findOpenEnrollment,
  insertChallenge,
  peekChallenge,
  revokeCredentials,
  revokeSessions,
} from './store';
import {
  registrationOptions,
  responseChallenge,
  verifyRegistration,
  type RegisteredCredential,
} from './webauthn';

/**
 * Passkey enrollment from a one-time link (ADR 0077). GET /enroll consumes
 * nothing; `beginEnrollment` issues a register challenge bound to the
 * enrollment; `finishEnrollment` verifies the attestation and, in one
 * transaction, consumes the challenge and the enrollment and stores the
 * credential, so of parallel finishes exactly one succeeds.
 */
const enrollAttempt = (address: string): Attempt => ({
  purpose: 'enroll',
  address,
});

const openEnrollment = (deps: AuthDeps, token: unknown, now: string) =>
  isSecret(token) ? findOpenEnrollment(deps.db, sha3(token), now) : null;

/** Both steps start alike: a rate-limit slot, then a still-open enrollment. */
async function openForAttempt(
  deps: AuthDeps,
  input: { readonly token: unknown; readonly address: string },
) {
  const slot = await reserveAttempt(deps, enrollAttempt(input.address));
  if ('code' in slot) return slot;
  const now = deps.clock.now();
  const open = await openEnrollment(deps, input.token, now);
  if (!open) return refuse(deps, slot, 'enrollment_invalid');
  return { slot, open, now };
}

export async function beginEnrollment(
  deps: AuthDeps,
  input: { readonly token: unknown; readonly address: string },
): Promise<
  | Refusal
  | {
      readonly ok: true;
      readonly options: PublicKeyCredentialCreationOptionsJSON;
    }
> {
  const opened = await openForAttempt(deps, input);
  if ('code' in opened) return opened;
  const { slot, open, now } = opened;
  const bytes = deps.random(SECRET_BYTES);
  await insertChallenge(deps.db, {
    id: deps.ids.next(),
    purpose: 'register',
    enrollmentId: open.enrollment.id,
    challengeHash: sha3(toBase64Url(bytes)),
    now,
    expiresAt: challengeExpiry(now),
  });
  const options = await registrationOptions({
    operatorId: open.operator.id,
    displayName: open.operator.displayName,
    challenge: bytes,
    existing: await activeCredentials(deps.db, open.operator.id),
  });
  await releaseAttempt(deps, slot);
  return { ok: true, options };
}

class EnrollmentTaken extends Error {}

type Enrolling = {
  readonly enrollmentId: string;
  readonly operatorId: string;
  readonly mode: string;
  readonly challengeHash: string;
  readonly credential: RegisteredCredential;
};

const audit = (
  deps: AuthDeps,
  tx: AdminTransaction,
  operatorId: string,
  kind: 'operator.enrolled' | 'credential.revoked' | 'session.revoked',
  detail: 'initial' | 'additional' | 'replace' | 'replaced',
  now: string,
) =>
  appendAudit(tx, {
    id: deps.ids.next(),
    kind,
    operatorId,
    commandId: null,
    targetUserId: null,
    outcome: null,
    detail,
    at: now,
  });

/** `--replace` (lost passkey) revokes every other credential and session. */
async function replacePrevious(
  deps: AuthDeps,
  tx: AdminTransaction,
  input: Enrolling & { readonly keep: string; readonly now: string },
) {
  const { operatorId, now } = input;
  if ((await revokeCredentials(tx, { operatorId, keep: input.keep, now })) > 0)
    await audit(deps, tx, operatorId, 'credential.revoked', 'replaced', now);
  if ((await revokeSessions(tx, { operatorId, now })) > 0)
    await audit(deps, tx, operatorId, 'session.revoked', 'replaced', now);
}

function storeEnrollment(deps: AuthDeps, input: Enrolling, now: string) {
  return deps.db.transaction(async (tx) => {
    const consumed =
      (await consumeChallenge(tx, {
        challengeHash: input.challengeHash,
        purpose: 'register',
        enrollmentId: input.enrollmentId,
        now,
      })) && (await consumeEnrollment(tx, input.enrollmentId, now));
    if (!consumed) throw new EnrollmentTaken('Enrollment already consumed');
    const id = deps.ids.next();
    await tx.insert(operatorCredentials).values({
      id,
      operatorId: input.operatorId,
      credentialId: input.credential.credentialId,
      publicKey: input.credential.publicKey,
      signCount: input.credential.signCount,
      transports: [...input.credential.transports],
      backedUp: input.credential.backedUp,
      createdAt: new Date(now),
    });
    if (input.mode === 'replace')
      await replacePrevious(deps, tx, { ...input, keep: id, now });
    const mode = input.mode as 'initial' | 'additional' | 'replace';
    await audit(deps, tx, input.operatorId, 'operator.enrolled', mode, now);
  });
}

/** The open register challenge this response answers, bound to this enrollment. */
async function answeredChallenge(
  deps: AuthDeps,
  response: RegistrationResponseJSON,
  enrollmentId: string,
  now: string,
) {
  const challenge = responseChallenge(response.response.clientDataJSON);
  if (!isSecret(challenge)) return null;
  const challengeHash = sha3(challenge);
  const pending = await peekChallenge(deps.db, challengeHash, 'register', now);
  return pending?.enrollmentId === enrollmentId
    ? { challenge, challengeHash }
    : null;
}

export async function finishEnrollment(
  deps: AuthDeps,
  input: {
    readonly token: unknown;
    readonly address: string;
    readonly response: RegistrationResponseJSON;
  },
): Promise<Refusal | { readonly ok: true }> {
  const opened = await openForAttempt(deps, input);
  if ('code' in opened) return opened;
  const { slot, open, now } = opened;
  const operatorId = open.operator.id;
  const answered = await answeredChallenge(
    deps,
    input.response,
    open.enrollment.id,
    now,
  );
  if (!answered) return refuse(deps, slot, 'challenge_invalid', operatorId);
  const { challenge, challengeHash } = answered;
  const credential = await verifyRegistration({
    response: input.response,
    challenge,
    ceremony: deps.ceremony,
  });
  if (!credential) return refuse(deps, slot, 'verification_failed', operatorId);
  const enrolling = {
    enrollmentId: open.enrollment.id,
    operatorId,
    mode: open.enrollment.mode,
    challengeHash,
    credential,
  };
  try {
    await storeEnrollment(deps, enrolling, now);
  } catch (error) {
    if (error instanceof EnrollmentTaken)
      return refuse(deps, slot, 'enrollment_invalid', operatorId);
    if (isUniqueViolation(error))
      return refuse(deps, slot, 'credential_duplicate', operatorId);
    throw error;
  }
  await releaseAttempt(deps, slot);
  return { ok: true };
}
