/** Projection shared across HTTP and realtime; read from durable rows under the caller's transaction. */
export type AuthorizationAccountRow = {
  readonly userId: string;
  readonly actorId: string | null;
  readonly actorKind: string | null;
  readonly actorUserId: string | null;
  readonly username: string | null;
  readonly emailVerified: boolean;
  readonly deletedAt: string | null;
  readonly revision: number;
};
export function authorizationAccountFact(row: AuthorizationAccountRow | null) {
  if (!row) return null;
  const actorBound =
    row.actorKind === 'human' &&
    row.actorUserId === row.userId &&
    row.actorId !== null;
  return {
    userId: row.userId,
    actorId: actorBound ? row.actorId : null,
    member:
      actorBound &&
      row.emailVerified === true &&
      typeof row.username === 'string' &&
      row.username.length > 0 &&
      row.deletedAt === null,
    erased: row.deletedAt !== null,
    revision: row.revision,
  };
}
