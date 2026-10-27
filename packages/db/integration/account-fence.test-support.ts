import type { SQL } from 'bun';

/** The exact v1 account and Room reader result, and the age reader's (ADR 0075). */
export const v1AccountColumns = [
  'userId',
  'actorId',
  'member',
  'erased',
  'revision',
];
export const ageColumns = [
  'actorId',
  'band',
  'revision',
  'accountRevision',
  'validUntil',
];

/**
 * The column names of the v1 account, v1 Room and age reads on one live
 * connection; run twice, the second run reuses the prepared statements.
 */
export async function legacyReadShapes(
  live: SQL,
  account: { readonly userId: string; readonly actorId: string },
) {
  const { userId, actorId } = account;
  const [fence] =
    await live`select * from public.daisy_authorization_accounts(null::text[], ${userId}::text, false)`;
  const [room] =
    await live`select * from public.daisy_room_read_account(${actorId}::text, ${userId}::text)`;
  const [age] =
    await live`select * from public.daisy_authorization_age(${userId}, ${actorId}, 1, clock_timestamp())`;
  return [fence, room, age].map((row) => Object.keys(row ?? {}));
}
