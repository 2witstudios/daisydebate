import {
  betaAccessStates,
  idSchema,
  type BetaAccessState,
} from '@daisy/protocol';
/** Minimal facts returned only by the canonical database account producer. */
export type AuthorizationAccountRow = {
  readonly userId: string;
  readonly actorId: string | null;
  readonly member: boolean;
  readonly erased: boolean;
  readonly revision: number;
  /** ADR 0075: the account's own beta access row, both null when it has none. */
  readonly betaState: string | null;
  readonly betaRevision: number | null;
  /** ADR 0075: the account's age band now, from its durable age record; null without one. */
  readonly ageBand: string | null;
};
const ageBands = ['under-13', '13-15', '16-17', 'adult'] as const;
function validBeta(row: AuthorizationAccountRow) {
  if (row.betaState === null)
    return row.betaRevision === null ? null : undefined;
  if (
    !betaAccessStates.includes(row.betaState as BetaAccessState) ||
    !Number.isSafeInteger(row.betaRevision) ||
    (row.betaRevision as number) < 1
  )
    return undefined;
  return {
    state: row.betaState as BetaAccessState,
    revision: row.betaRevision as number,
  };
}
function validIdentity(row: AuthorizationAccountRow): boolean {
  return (
    idSchema.safeParse(row.userId).success &&
    (row.actorId === null || idSchema.safeParse(row.actorId).success)
  );
}
/** Validate persistence output before it enters either HTTP or realtime authority. */
export function authorizationAccountFact(row: AuthorizationAccountRow | null) {
  if (!row || !validIdentity(row)) return null;
  if (typeof row.member !== 'boolean' || typeof row.erased !== 'boolean')
    return null;
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) return null;
  if (row.member && (row.actorId === null || row.erased)) return null;
  const beta = validBeta(row);
  if (beta === undefined) return null;
  const ageBand =
    row.ageBand === null
      ? null
      : (ageBands.find((band) => band === row.ageBand) ?? undefined);
  if (ageBand === undefined) return null;
  return {
    userId: row.userId,
    actorId: row.actorId,
    member: row.member,
    erased: row.erased,
    revision: row.revision,
    beta,
    ageBand,
  };
}
