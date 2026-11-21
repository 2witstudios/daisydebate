import { requireTestServices } from '@daisy/config';
import { isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { buildRoomTopic } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAuthorizationSubject } from './authorization.test-support';
import { withDatabase, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('Room commands retry a real change between preparation and locking, with a finite refusal', async () => {
  await withFixture(url, async (fixture) => {
    const caller = await createAuthorizationSubject(fixture);
    const roomId = await fixture.room(caller.actorId, await fixture.format(), {
      execution_plan: {
        preRoundPrep: { enabled: false },
        resolutionDraw: { enabled: false },
      },
    });
    const topic = buildRoomTopic(roomId);
    try {
      await withDatabase(url, async (database) => {
        const times = [0, 0];
        const make = (scenario: 0 | 1) => ({
          caller,
          roomId,
          actorId: caller.actorId,
          type: 'update-details',
          commandId: createId(),
          payloadDigest: 'f'.repeat(64),
          targetActorId: null,
          formatTuple: null,
          roundId: createId(),
          seatsBotDebater: () => false,
          readyAgreements: () => null,
          authorizeRead: (
            room: { hostActorId: string | null },
            account: { member: boolean } | null,
          ) => room.hostActorId === caller.actorId && account?.member === true,
          prepare: async () => {
            times[scenario] = (times[scenario] ?? 0) + 1;
            if (scenario === 0 || times[1] === 1)
              await fixture.sql`update rooms set change_version=change_version+1 where id=${roomId}`;
            return (
              state: Parameters<
                Parameters<typeof database.executeRoomCommand>[0]['prepare']
              >[0],
            ) => ({
              ok: true as const,
              mutation: {
                state: {
                  ...state,
                  title: 'Proof renamed',
                  version: state.version + 1,
                  changeVersion: state.changeVersion + 1,
                },
                consent: null,
                freeze: false as const,
                seatsBotDebater: false,
                publishDefinition: false,
                draw: null,
                seatDraw: null,
                roundSeed: null,
                members: [],
              },
            });
          },
        });
        const stale = make(0);
        const refusal = await database.executeRoomCommand(stale).then(
          () => null,
          (error: unknown) => {
            if (!isAppError(error)) throw error;
            return { code: error.code, reason: error.reason };
          },
        );
        const ready = make(1);
        const receipt = await database.executeRoomCommand(ready);
        const [stored] =
          await fixture.sql`select title,version from rooms where id=${roomId}`;
        const [record] =
          await fixture.sql`select command_id from room_commands where room_id=${roomId}`;
        assert({
          given:
            'a Room moved on each of three preparations, then once more on the next command',
          should:
            'refuse perpetual churn, succeed after one retry with fresh facts, and commit exactly one receipt and notification',
          actual: [
            times,
            refusal,
            receipt,
            stored,
            record?.command_id,
            await fixture.count('outbox', 'topic', topic),
          ],
          expected: [
            [3, 2],
            { code: 'CONFLICT', reason: 'version-conflict' },
            {
              commandId: ready.commandId,
              roomId,
              resultingVersion: 2,
              roundRef: null,
              replayed: false,
            },
            { title: 'Proof renamed', version: 2 },
            ready.commandId,
            1,
          ],
        });
      });
    } finally {
      await fixture.sql`delete from outbox where topic=${topic}`;
    }
  });
});
