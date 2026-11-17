type Sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

/**
 * Removes the `user:inbox` signals for the notifications about a Room's
 * Rounds (ADR 0144): a Round going active or being decided rings its seated
 * members, and those rows outlive the Round they named unless the suite
 * that made them takes them back. Call before deleting the Rounds.
 */
export const deleteRoomNotificationSignals = async (
  sql: Sql,
  roomId: string | null,
) => {
  if (roomId === null) return;
  await sql`delete from outbox where kind='user.notification-delivered'
    and (payload->'ids'->>0) in (select n.id from notifications n
      join rounds r on r.id=n.round_id where r.room_id=${roomId})`;
};
