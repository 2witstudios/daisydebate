import { createAppError } from '@daisy/errors';
import { idSchema, messagingTypingSchemas } from '@daisy/protocol';
import {
  loadAuthorizationAccount,
  type AuthorizationTransaction,
} from '../authorization';
import type { PrivacySubject } from './contracts';
import { messagingTypingPrivacyDeclaration } from './typing-declaration';

/** External I/O runs outside the PostgreSQL adopter transaction, never in place of its commit. */
export function createMessagingTypingPrivacyPort(
  database: AuthorizationTransaction,
  producer: {
    /** Complete own-actor snapshot; no membership filter and no Redis key in output. */
    readonly exportSubject: (actorId: string) => Promise<unknown>;
    /** Idempotent complete physical deletion, including leases in channels no longer accessible. */
    readonly eraseSubject: (actorId: string) => Promise<void>;
  },
) {
  const accountFor = async (userId: string) => {
    const account = await loadAuthorizationAccount(database, userId);
    if (!account?.actorId) throw createAppError('AUTHORIZATION');
    return { ...account, actorId: account.actorId };
  };
  return {
    declaration: messagingTypingPrivacyDeclaration,
    async export(subject: PrivacySubject) {
      if (!idSchema.safeParse(subject.actorId).success)
        throw createAppError('VALIDATION');
      const account = await accountFor(subject.userId);
      if (account.actorId !== subject.actorId)
        throw createAppError('AUTHORIZATION');
      const raw = await external(() => producer.exportSubject(subject.actorId));
      const parsed = messagingTypingSchemas.lease.array().safeParse(raw);
      if (
        !parsed.success ||
        parsed.data.some((row) => row.actorId !== subject.actorId)
      )
        throw createAppError('VALIDATION');
      return parsed.data;
    },
    /** Supply to deliverPrivacyJob for vendor messaging-typing, after local erasure commits. */
    async erase(userId: string) {
      const account = await accountFor(userId);
      if (!account.erased) throw createAppError('AUTHORIZATION');
      await external(() => producer.eraseSubject(account.actorId));
    },
  };
}
async function external<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    // No vendor response, key or raw exception enters the rights result.
    throw createAppError('INFRASTRUCTURE');
  }
}
