import { requireTestServices } from '@daisy/config';
import { isNamedSeat, type RoomView } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('a launched Round names its human judge only to that judge and the host', async () => {
  await withRoomRuntime(async (f) => {
    const judge = f.outsider;
    const spectator = await f.member();
    const choice = (await f.operations.catalog(f.host)).find(
      (c) => c.formatId === 'foundation',
    )!;
    let view: RoomView = (
      await f.create({
        selection: {
          kind: 'custom',
          definition: {
            ...choice.definition,
            seats: { affirmative: 1, negative: 1, judge: 1 },
          },
          config: choice.defaultConfig,
          length: 'full',
          competitionType: 'casual',
        },
      })
    ).view;
    for (const [who, role] of [
      [f.host, 'affirmative'],
      [f.guest, 'negative'],
      [judge, 'judge'],
    ] as const)
      view = (await f.command(who, view, { type: 'claim-seat', role, slot: 0 }))
        .view;
    const roomId = view.id;
    const [judgeRoomSeat] = await f.sql<{ id: string }[]>`
      select id from room_participants where room_id=${roomId} and role='judge'`;
    const [judgeUser] = await f.sql<{ username: string }[]>`
      select username from users where id=${judge.userId}`;
    const secrets = [judge.actorId, judgeRoomSeat!.id, judgeUser!.username];
    const leaks = (value: object, hidden: readonly string[]) =>
      hidden.filter((secret) => JSON.stringify(value).includes(secret));

    // Every caller reads their own projection: the same boundary the page
    // and the API serve. A caller's own seat is always named there, so the
    // ready loop cannot depend on whose projection the last command left.
    const ownView = (who: typeof f.host) => f.operations.view(who, roomId);

    const lobby = {
      guest: await ownView(f.guest),
      spectator: await ownView(spectator),
    };
    assert({
      given:
        'a seated human judge, the assembly read by a debater and a spectator',
      should: 'carry no judge name, actor or seat id',
      actual: [leaks(lobby.guest, secrets), leaks(lobby.spectator, secrets)],
      expected: [[], []],
    });
    const lobbyKnowers = {
      judge: await ownView(judge),
      host: await ownView(f.host),
    };
    assert({
      given:
        'the same assembly read by its judge and by its host (negative control)',
      should:
        'name the judge, so the leak check above can see a judge identity',
      actual: [
        leaks(lobbyKnowers.judge, secrets).length > 0,
        leaks(lobbyKnowers.host, secrets).length > 0,
      ],
      expected: [true, true],
    });

    for (const who of [f.host, f.guest, judge]) {
      const own = await ownView(who);
      const seat = own.participants
        .filter(isNamedSeat)
        .find((p) => p.actorId === who.actorId)!;
      if (seat.needsReady) view = (await f.consent(who, own, 'ready')).view;
    }
    const seatedLobby = await ownView(f.guest);
    const judgeSeatInLobby = seatedLobby.participants.find(
      (p) => p.role === 'judge',
    )!;
    assert({
      given: 'the judge readied, the assembly read by a debater',
      should:
        'keep the judge seat anonymous but still show it ready, with the judge out of readyActorIds',
      actual: [
        'anonymous' in judgeSeatInLobby,
        judgeSeatInLobby.ready,
        seatedLobby.readiness.readyActorIds.includes(judge.actorId),
        leaks(seatedLobby, secrets),
      ],
      expected: [true, 'ready', false, []],
    });

    view = (await f.command(f.host, view, { type: 'start-round' })).view;
    const roundId = view.roundRef!.id;
    const [roundJudgeSeat] = await f.sql<{ id: string }[]>`
      select id from round_participants where round_id=${roundId} and role='judge'`;
    const roundSecrets = [
      ...secrets,
      roundJudgeSeat!.id,
      f.host.actorId === judge.actorId ? '' : 'hostActorId',
    ];
    const read = (who: typeof f.host) => f.operations.roundView(who, roundId);
    const asJudge = await read(judge);
    assert({
      given:
        'a scheduled Round with a human judge, read by a debater and a spectator',
      should: 'carry no judge name, actor, seat id or host actor',
      actual: [
        leaks(await read(f.guest), roundSecrets),
        leaks(await read(spectator), roundSecrets),
      ],
      expected: [[], []],
    });
    assert({
      given:
        'the same Round read by its judge and by its host (negative control)',
      should:
        'name the judge, so the leak check above can see a judge identity',
      actual: [
        leaks(asJudge, roundSecrets).length > 0,
        leaks(await read(f.host), roundSecrets).length > 0,
      ],
      expected: [true, true],
    });
  });
});
