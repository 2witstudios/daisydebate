type Sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

/**
 * Removes the `user:inbox` signals whose notification is gone (ADR 0144): a
 * Round going active or being decided rings its seated members, and when a
 * suite deletes the Round its notifications cascade away but their signals
 * stay. Call after deleting Rounds or Rooms. Suites run one at a time per
 * database, so this takes back only what the calling suite left.
 */
export const deleteOrphanNotificationSignals = async (sql: Sql) => {
  await sql`delete from outbox o where o.kind='user.notification-delivered'
    and not exists(select 1 from notifications n where n.id=o.payload->'ids'->>0)`;
};
