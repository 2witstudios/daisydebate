import type { SQL } from 'bun';
import { idSchema } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';

/** Inject an outbox failure only for this runner-owned Room, then release it. */
export async function withRoomOutboxFailure<T>(
  sql: SQL,
  roomId: string,
  run: () => Promise<T>,
): Promise<T> {
  const checkedRoomId = idSchema.parse(roomId);
  const name = `room_rollback_${createId()}`;
  try {
    await sql.unsafe(
      `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.topic = 'room:${checkedRoomId}' THEN RAISE EXCEPTION 'proof rollback'; END IF; RETURN NEW; END $$`,
    );
    await sql.unsafe(
      `CREATE TRIGGER "${name}" BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
    );
    return await run();
  } finally {
    await sql.unsafe(`DROP TRIGGER IF EXISTS "${name}" ON outbox`);
    await sql.unsafe(`DROP FUNCTION IF EXISTS "${name}"()`);
  }
}
