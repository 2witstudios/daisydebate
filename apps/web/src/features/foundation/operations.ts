import type { Clock, IdGenerator } from '@daisy/clock';
import { createAppError, isAppError } from '@daisy/errors';
import { requirePermission, type Principal } from '@daisy/auth';
import {
  createDebateRuntime,
  restoreDebateRuntime,
  type DebateSnapshot,
} from '@daisy/debate-engine';
import { getResources } from '../../server/resources';
import { parseValidated } from '../../server/http';
import { proofDebateIdSchema, proofDebateInputSchema } from './schemas';

/**
 * Development-only architectural proof: transport → validated operation →
 * domain runtime → durable adapter → PostgreSQL. Gated by
 * FOUNDATION_PROOF_ENABLED; production configuration forbids enabling it.
 */
const proofPrincipal: Principal = {
  kind: 'service',
  serviceId: 'foundation-proof',
  permissions: ['debate:create'],
};

function requireProofEnabled() {
  if (!getResources().config.FOUNDATION_PROOF_ENABLED)
    throw createAppError('NOT_FOUND');
}

async function withDurableContext<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isAppError(error)) throw error;
    throw createAppError('INFRASTRUCTURE', undefined, error);
  }
}

export async function createProofDebate(
  input: unknown,
  primitives: { clock: Clock; ids: IdGenerator },
): Promise<DebateSnapshot> {
  requireProofEnabled();
  requirePermission(proofPrincipal, 'debate:create');
  const { resolution } = parseValidated(proofDebateInputSchema, input);
  const runtime = createDebateRuntime({
    id: primitives.ids.next(),
    resolution,
    createdAt: primitives.clock.now(),
  });
  try {
    const snapshot = runtime.snapshot();
    return await withDurableContext(async () => {
      await getResources().database.createDebate({
        id: snapshot.id,
        createdBy: null,
        resolution: snapshot.resolution,
        format: snapshot.format,
        snapshot,
      });
      return snapshot;
    });
  } finally {
    runtime.dispose();
  }
}

/**
 * Reads go through the same Principal gate as creation. `@daisy/auth` has no
 * read permission yet, so the proof principal reads back under the one
 * permission it holds rather than being widened to `debate:manage`.
 */
export async function getProofDebate(
  id: string,
  principal: Principal = proofPrincipal,
): Promise<DebateSnapshot> {
  requireProofEnabled();
  requirePermission(principal, 'debate:create');
  const debateId = parseValidated(proofDebateIdSchema, id);
  return withDurableContext(async () => {
    const record = await getResources().database.getDebate(debateId);
    if (!record) throw createAppError('NOT_FOUND');
    const runtime = restoreDebateRuntime(record.snapshot);
    try {
      return runtime.snapshot();
    } finally {
      runtime.dispose();
    }
  });
}
