import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createAppError, isAppError } from '@daisy/errors';
import type { BoundedTransaction } from '../bounded-transaction';
import { transcriptionRecoveryContexts as contexts } from '../schema/transcription-recovery';
import { policy, workerInput, claimInput } from './policy';
import { discover } from './discover';
import { claim } from './claim';
import { current } from './current';
import { begin } from './begin';
import { retry } from './retry';
import { candidate } from './candidate';
import { missing } from './missing';
import { enroll } from './enroll';

/** Existing competitive transaction/pool only. Every candidate gets a fresh account-before-Round transaction. */
export function create(
  input: z.infer<typeof policy> & {
    run: BoundedTransaction;
    nextToken: () => string;
  },
) {
  const { run, nextToken, ...raw } = input,
    configured = policy.parse(raw);
  const options = {
    ...configured,
    policyDigest: new Bun.CryptoHasher('sha3-256')
      .update(JSON.stringify({ version: 1, ...configured }))
      .digest('hex'),
  };
  if (typeof nextToken !== 'function') throw createAppError('VALIDATION');
  const parsed = <T>(schema: z.ZodType<T>, value: unknown) => {
    const result = schema.safeParse(value);
    if (!result.success) throw createAppError('VALIDATION');
    return result.data;
  };
  return {
    missing() {
      return run((tx) => missing(tx));
    },
    enroll(raw: unknown) {
      const input = parsed(z.strictObject({ body: z.unknown() }), raw);
      return run((tx) => enroll(tx, input.body));
    },
    async claim(raw: unknown) {
      const worker = parsed(workerInput, raw),
        targets = await run((tx) => discover(tx, options));
      for (const target of targets) {
        try {
          const result = await run((tx) =>
            claim(tx, { ...worker, ...target }, { ...options, nextToken }),
          );
          if (result.kind !== 'idle') return result;
        } catch (error) {
          if (
            !isAppError(error) ||
            !['CONFLICT', 'AUTHORIZATION', 'NOT_FOUND'].includes(error.code)
          )
            throw error;
        }
      }
      return { kind: 'idle' as const };
    },
    verify(raw: unknown) {
      const scope = parsed(claimInput, raw);
      return run(async (tx) => {
        const owned = await current(tx, scope, options);
        return {
          kind: 'current' as const,
          evidenceIds: owned.members.map((unit) => unit.evidenceId),
          attempts: owned.context.attempts,
          model: owned.context.model!,
          policyDigest: owned.context.policyDigest!,
        };
      });
    },
    renew(raw: unknown) {
      const scope = parsed(claimInput, raw);
      return run(async (tx) => {
        const owned = await current(tx, scope, options),
          expiresAt = new Date(owned.now.getTime() + options.leaseMs);
        await tx
          .update(contexts)
          .set({ leaseExpiresAt: expiresAt })
          .where(eq(contexts.id, scope.contextId));
        return { kind: 'renewed' as const, expiresAt: expiresAt.toISOString() };
      });
    },
    begin(raw: unknown) {
      const scope = parsed(claimInput, raw);
      return run((tx) => begin(tx, scope, options));
    },
    retry(raw: unknown) {
      const scope = parsed(
        claimInput.extend({
          reason: z.enum(['provider', 'quality', 'uncertain']),
        }),
        raw,
      );
      return run((tx) => retry(tx, scope, options));
    },
    recordCandidate(raw: unknown) {
      const { text, ...scope } = parsed(
          claimInput.extend({ text: z.string().max(65536) }),
          raw,
        ),
        bytes = Buffer.byteLength(text);
      if (bytes > 65536) throw createAppError('VALIDATION');
      const digest = new Bun.CryptoHasher('sha3-256')
        .update(text)
        .digest('hex');
      return run((tx) => candidate(tx, { ...scope, digest, bytes }, options));
    },
  };
}
