import { requireTestServices } from '@daisy/config';
import { isRoundRunning } from '@daisy/protocol/round';
import { negativeSide, sideSeat } from '@daisy/protocol/seats';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

/**
 * TAB-6.16: a seat is what holds a person. Whoever sits in an open Room or a
 * running Round is refused a seat anywhere else; hosting holds no one, so a
 * host without a seat may host another Room, and finds both again.
 */
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

/** The refusal reason a command answers with, or `accepted`. */
const answerOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 'accepted',
    (error: { readonly reason?: string }) => error.reason ?? 'error',
  );

const claimNegative = (
  f: Fixture,
  who: Fixture['host'],
  room: Awaited<ReturnType<Fixture['create']>>['view'],
) => f.command(who, room, { type: 'claim-seat', seat: sideSeat(negativeSide) });

test('a person seated in an open Room is refused a second seat, while a seatless host hosts two Rooms and lists both (TAB-6.16)', async () => {
  await withRoomRuntime(async (f) => {
    const first = (await f.create({ title: 'First room' })).view;
    await claimNegative(f, f.guest, first);
    const second = await answerOf(f.create({ title: 'Second room' }));
    const [hostedRoom] = (await f.store.listHostedRooms(f.host, () => true))
      .filter((room) => room.id !== first.id)
      .map((room) => room.id);
    const secondView = await f.operations.view(f.host, hostedRoom!);
    assert({
      given: 'a host with no seat in their open Room, and a guest seated in it',
      should:
        'let the host create a second Room, list both as hosted without a seat, and refuse the guest a seat in it',
      actual: {
        second,
        hosted: (await f.store.listHostedRooms(f.host, () => true)).map(
          (room) => [room.title, room.status, room.seated],
        ),
        guestActive: (await f.operations.activeRoom(f.guest))?.id,
        hostActive: await f.operations.activeRoom(f.host),
        guestSecondSeat: await answerOf(claimNegative(f, f.guest, secondView)),
      },
      expected: {
        second: 'accepted',
        hosted: [
          ['Second room', 'assembling', false],
          ['First room', 'assembling', false],
        ],
        guestActive: first.id,
        hostActive: null,
        guestSecondSeat: 'active-room',
      },
    });
  });
});

test('a person seated in a running Round is refused a seat in another Room (TAB-6.16)', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble();
    const { roundId } = await launchRuntimeRound(f, room);
    const elsewhere = (await f.create({ title: 'Elsewhere' }, f.outsider)).view;
    assert({
      given: 'both debaters of a running Round, then a Room another host opens',
      should:
        'refuse each of them a seat in it, as their Round still holds them',
      actual: {
        running: isRoundRunning((await f.store.getRound(roundId))!.status),
        host: await answerOf(claimNegative(f, f.host, elsewhere)),
        guest: await answerOf(claimNegative(f, f.guest, elsewhere)),
      },
      expected: {
        running: true,
        host: 'active-room',
        guest: 'active-room',
      },
    });
  });
});
