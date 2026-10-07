import type { IdGenerator } from '@daisy/clock';
import type { Database } from '@daisy/db';
import { createAppError, isAppError } from '@daisy/errors';
import { requirePermission, type Principal } from '@daisy/auth';
import { resolveRoomConfiguration as resolveRoom } from '@daisy/debate-engine';
import type { RoundStatus, RoundRules } from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { proofDebateIdSchema, proofDebateInputSchema } from './schemas';

/**
 * Development-only architectural proof: transport → validated operation →
 * domain compiler → durable adapter → PostgreSQL. Gated by
 * FOUNDATION_PROOF_ENABLED; production configuration forbids enabling it.
 */
export const proofPrincipal: Principal = Object.freeze({
  kind: 'service',
  serviceId: 'foundation-proof',
  permissions: Object.freeze(['debate:create', 'debate:read'] as const),
});

const proofFormat = 'foundation';

/** The proof room's config: the foundation format at its defaults. */
const proofConfig = {
  preRoundPrep: { enabled: false },
  inRoundPrep: { enabled: true, budgetMsPerSide: 120_000 },
  speechTiming: { countdownMs: 10_000, segmentDurationOverrides: {} },
  crossExamination: { crossExMode: 'ordered' },
  interruptions: null,
  yielding: null,
} as const;

/** Everything the proof operations touch, injected by the composition root. */
export type ProofDependencies = {
  /** `FOUNDATION_PROOF_ENABLED` from validated server config. */
  readonly enabled: boolean;
  readonly database: Pick<Database, 'getFormat' | 'createRound' | 'getRound'>;
  readonly ids: IdGenerator;
};

function requireProofEnabled(dependencies: ProofDependencies) {
  if (!dependencies.enabled) throw createAppError('NOT_FOUND');
}

async function withDurableContext<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isAppError(error)) throw error;
    throw createAppError('INFRASTRUCTURE', undefined, error);
  }
}

export type ProofRound = {
  readonly id: string;
  readonly resolution: string;
  readonly format: string;
  readonly formatVersion: number;
  readonly rules: RoundRules;
  readonly status: RoundStatus;
};

/**
 * Resolves the proof round through the one compiler and freezes it as a
 * scheduled casual round — the canonical foundation rules, unmodified
 * (ADR 0030), resolved exactly as a room would resolve them.
 */
export async function createProofDebate(
  input: unknown,
  dependencies: ProofDependencies,
  principal: Principal = proofPrincipal,
): Promise<ProofRound> {
  requireProofEnabled(dependencies);
  requirePermission(principal, 'debate:create');
  const { resolution } = parseValidated(proofDebateInputSchema, input);
  const format = await withDurableContext(() =>
    dependencies.database.getFormat(proofFormat),
  );
  if (!format) throw createAppError('INFRASTRUCTURE');
  const resolved = resolveRoom(format.definition, proofConfig);
  if (!resolved.ok)
    throw createAppError(
      'INFRASTRUCTURE',
      `The proof room refuses to resolve: ${resolved.refusal.message}`,
    );
  const id = dependencies.ids.next();
  await withDurableContext(() =>
    dependencies.database.createRound({
      id,
      createdByActorId: null,
      resolution,
      competitionType: 'casual',
      length: 'full',
      formatId: format.id,
      formatVersion: format.version,
      presetVersion: null,
      rules: resolved.rules,
    }),
  );
  return {
    id,
    resolution,
    format: format.id,
    formatVersion: format.version,
    rules: resolved.rules,
    status: 'scheduled',
  };
}

/**
 * Reads pass the Principal gate before any database access and require
 * `debate:read`; holding `debate:create` alone does not admit a read. The
 * proof principal holds exactly create and read, never `debate:manage`.
 */
export async function getProofDebate(
  id: string,
  dependencies: ProofDependencies,
  principal: Principal = proofPrincipal,
): Promise<ProofRound> {
  requireProofEnabled(dependencies);
  requirePermission(principal, 'debate:read');
  const roundId = parseValidated(proofDebateIdSchema, id);
  return withDurableContext(async () => {
    const round = await dependencies.database.getRound(roundId);
    if (!round) throw createAppError('NOT_FOUND');
    return {
      id: round.id,
      resolution: round.resolution,
      format: round.formatId,
      formatVersion: round.formatVersion,
      rules: round.rules,
      status: round.status,
    };
  });
}
