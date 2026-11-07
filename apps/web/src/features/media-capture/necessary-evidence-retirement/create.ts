import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import { idSchema, type NecessaryEvidenceCustody } from '@daisy/protocol';
type Store = ReturnType<Database['createNecessaryEvidenceRetirement']>;
type Lane = 'attached' | 'detached';
type Outcome = 'idle' | 'retired' | 'pending' | 'blocked';
/** LOCAL injected composition only; no production startup/configuration is installed here. */
export function create(options: {
  readonly store: Store;
  readonly custody: NecessaryEvidenceCustody;
  readonly workerId: string;
}) {
  if (!idSchema.safeParse(options.workerId).success)
    throw createAppError('VALIDATION');
  const attempt = async (lane: Lane): Promise<Outcome> => {
    let held: Awaited<ReturnType<Store['claim']>> | undefined;
    try {
      held = await options.store.claim({ workerId: options.workerId, lane });
      if (held.kind !== 'claimed') return 'idle';
      if (!held.identity.authorityId) {
        await options.store.retry(held);
        return 'blocked';
      }
      const result = await options.custody.revoke({
        ...held.identity,
        authorityId: held.identity.authorityId,
      });
      if (result.kind === 'revoked') {
        const completed = await options.store.complete(held);
        if (completed.kind === 'retired') return 'retired';
      }
      await options.store.retry(held);
      return 'pending';
    } catch {
      // Unknown outcome never releases debt. Lease takeover remains durable if retry acknowledgement is also lost.
      if (held?.kind === 'claimed') {
        try {
          await options.store.retry(held);
        } catch {
          /* Persisted claim expires; same ID/realm remains due. */
        }
      }
      return 'pending';
    }
  };
  const runOnce = async () => ({
    attached: await attempt('attached'),
    detached: await attempt('detached'),
  });
  return {
    runOnce,
    async run(input: {
      readonly signal: AbortSignal;
      readonly pollMs: number;
      readonly pause: (ms: number, signal: AbortSignal) => Promise<void>;
    }) {
      if (
        !Number.isSafeInteger(input.pollMs) ||
        input.pollMs < 1000 ||
        input.pollMs > 60000
      )
        throw createAppError('VALIDATION');
      // Each pass independently visits both lanes; no attached backlog can hide detached cleanup.
      while (!input.signal.aborted) {
        await runOnce();
        if (input.signal.aborted) break;
        try {
          await input.pause(input.pollMs, input.signal);
        } catch (error) {
          if (!input.signal.aborted) throw error;
        }
      }
      return { kind: 'stopped' as const };
    },
  };
}
