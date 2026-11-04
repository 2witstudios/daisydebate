import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomFacts } from '../src/room-command-facts';
import { rooms } from '../src/schema/rooms';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('a Room reads its seats in one order, whatever wrote to them last', async () => {
  await withFixture(databaseUrl, async (f) => {
    const format = await f.format();
    const roomId = await f.room(await f.actor(), format, {
      visibility: 'public',
    });
    const seat = async (role: string) => {
      const id = createId();
      await f.insert('room_participants', {
        id,
        room_id: roomId,
        actor_id: await f.actor(),
        role,
        slot: 0,
      });
      return id;
    };
    const judge = await seat('judge');
    await seat('negative');
    await seat('affirmative');
    const client = new SQL(databaseUrl, { max: 1 });
    try {
      const database = drizzle({ client });
      const roles = async () => {
        const [row] = await database
          .select()
          .from(rooms)
          .where(eq(rooms.id, roomId));
        const { state } = await roomFacts(database as never, row!);
        return state.participants.map((participant) => participant.role);
      };
      const before = await roles();
      await f.sql`update room_participants set readiness_version=1 where id=${judge}`;
      assert({
        given: 'a seat written after the others',
        should: 'read the seats in the same order',
        actual: [before, await roles()],
        expected: [
          ['affirmative', 'judge', 'negative'],
          ['affirmative', 'judge', 'negative'],
        ],
      });
    } finally {
      await client.close();
    }
  });
});
