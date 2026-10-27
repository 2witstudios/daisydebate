import type { Clock, IdGenerator } from '@daisy/clock';
import { appendAudit } from '../audit/store';
import type { AdminDatabase } from '../db/client';
import { operatorEnrollments, operators } from '../db/schema';
import { isUniqueViolation } from './attempts';
import { enrollmentExpiry } from './lifetimes';
import { ADMIN_ORIGIN } from './origin';
import { mintSecret, sha3, type RandomBytes } from './secrets';
import { findActiveOperatorByName, revokeOpenEnrollments } from './store';

/**
 * The bootstrap CLI's one operation (ADR 0077), run over `fly ssh console`:
 * mint a 15-minute enrollment link for an operator. A first enrollment
 * creates the owner and refuses a second one; `--additional` adds a
 * passkey and `--replace` (lost passkey) revokes the others when consumed.
 * Earlier unconsumed links for the operator stop working.
 */
export type EnrollmentMode = 'initial' | 'additional' | 'replace';
export type IssueResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

const ownerExists =
  'An owner already exists; use --additional or --replace for that operator';

class Refused extends Error {}

async function operatorFor(
  tx: Parameters<Parameters<AdminDatabase['transaction']>[0]>[0],
  input: { readonly name: string; readonly mode: EnrollmentMode },
  deps: { readonly ids: IdGenerator; readonly now: string },
): Promise<string> {
  const existing = await findActiveOperatorByName(tx, input.name);
  if (input.mode !== 'initial') {
    if (!existing) throw new Refused(`No active operator named ${input.name}`);
    return existing.id;
  }
  if (existing) throw new Refused(ownerExists);
  const id = deps.ids.next();
  await tx.insert(operators).values({
    id,
    displayName: input.name,
    role: 'owner',
    createdAt: new Date(deps.now),
  });
  return id;
}

export async function issueEnrollment(
  deps: {
    readonly db: AdminDatabase;
    readonly clock: Clock;
    readonly ids: IdGenerator;
    readonly random: RandomBytes;
  },
  input: { readonly name: string; readonly mode: EnrollmentMode },
): Promise<IssueResult> {
  const now = deps.clock.now();
  const token = mintSecret(deps.random);
  try {
    await deps.db.transaction(async (tx) => {
      const operatorId = await operatorFor(tx, input, { ids: deps.ids, now });
      await revokeOpenEnrollments(tx, operatorId, now);
      await tx.insert(operatorEnrollments).values({
        id: deps.ids.next(),
        operatorId,
        tokenHash: sha3(token),
        mode: input.mode,
        createdAt: new Date(now),
        expiresAt: new Date(enrollmentExpiry(now)),
      });
      await appendAudit(tx, {
        id: deps.ids.next(),
        kind: 'enrollment.issued',
        operatorId,
        commandId: null,
        targetUserId: null,
        outcome: null,
        detail: input.mode,
        at: now,
      });
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.message };
    // The partial unique index: a concurrent first enrollment won.
    if (isUniqueViolation(error)) return { ok: false, reason: ownerExists };
    throw error;
  }
  // The token rides in the fragment, so it never reaches a server log.
  return { ok: true, url: `${ADMIN_ORIGIN}/enroll#${token}` };
}
