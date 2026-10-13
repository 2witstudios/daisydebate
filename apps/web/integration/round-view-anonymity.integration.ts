import { requireTestServices } from '@daisy/config';
import { isNamedSeat, type RoomView, type RoundView } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('a launched Round names its human judge only to that judge and the host', async () => {
  await withRoomRuntime(async (f) => {
    const judge = f.outsider;
    const spectator = await f.member();
    let view: RoomView = (await f.create()).view;
    for (const [who, role] of [
      [f.host, 'affirmative'],
      [f.guest, 'negative'],
      [judge, 'judge'],
    ] as const)
      view = (await f.command(who, view, { type: 'claim-seat', role, slot: 0 }))
        .view;
    for (const who of [f.host, f.guest, judge]) {
      const seat = view.participants
        .filter(isNamedSeat)
        .find((p) => p.actorId === who.actorId)!;
      if (seat.needsReady) view = (await f.consent(who, view, 'ready')).view;
    }
    view = (await f.command(f.host, view, { type: 'start-round' })).view;
    const roundId = view.roundRef!.id;
    const [judgeSeat] = await f.sql<{ id: string }[]>`
      select id from round_participants where round_id=${roundId} and role='judge'`;
    const [judgeUser] = await f.sql<{ username: string }[]>`
      select username from users where id=${judge.userId}`;
    const secrets = [
      judge.actorId,
      judgeSeat!.id,
      judgeUser!.username,
      f.host.actorId === judge.actorId ? '' : 'hostActorId',
    ];
    const leaks = (round: RoundView) =>
      secrets.filter((secret) => JSON.stringify(round).includes(secret));
    const read = (who: typeof f.host) => f.operations.roundView(who, roundId);
    const asJudge = await read(judge);
    assert({
      given:
        'a scheduled Round with a human judge, read by a debater and a spectator',
      should: 'carry no judge name, actor, seat id or host actor',
      actual: [leaks(await read(f.guest)), leaks(await read(spectator))],
      expected: [[], []],
    });
    assert({
      given:
        'the same Round read by its judge and by its host (negative control)',
      should:
        'name the judge, so the leak check above can see a judge identity',
      actual: [leaks(asJudge).length > 0, leaks(await read(f.host)).length > 0],
      expected: [true, true],
    });
  });
});
