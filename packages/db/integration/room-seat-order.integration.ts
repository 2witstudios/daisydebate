import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomFacts } from '../src/room-command-facts';
import { rooms } from '../src/schema/rooms';
import { seatKey } from '@daisy/protocol';
import { seatColumnsOf, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('a Room reads its seats by side or kind, then slot, not in storage order', async () => {
  await withFixture(databaseUrl, async (f) => {
    const format = await f.format();
    const roomId = await f.room(await f.actor(), format, {
      visibility: 'public',
    });
    for (const [role, slot] of [
      ['judge', 0],
      ['negative', 0],
      ['affirmative', 1],
      ['affirmative', 0],
    ] as const)
      await f.insert('room_participants', {
        id: createId(),
        room_id: roomId,
        actor_id: await f.actor(),
        ...seatColumnsOf(role),
        slot,
      });
    const database = drizzle({ client: f.sql });
    const [row] = await database
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId));
    const { state } = await roomFacts(database as never, row!);
    assert({
      given: 'seats stored out of order',
      should: 'read them by side or kind, then slot',
      actual: state.participants.map(({ seat }) => seatKey(seat)),
      expected: ['affirmative:0', 'affirmative:1', 'judge:0', 'negative:0'],
    });
  });
});
