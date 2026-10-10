import { idSchema } from '@daisy/protocol';
/** Minimal facts returned only by the canonical database account producer. */
export type AuthorizationAccountRow = {
  readonly userId: string;
  readonly actorId: string | null;
  readonly member: boolean;
  readonly erased: boolean;
  readonly revision: number;
};
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
  return {
    userId: row.userId,
    actorId: row.actorId,
    member: row.member,
    erased: row.erased,
    revision: row.revision,
  };
}
