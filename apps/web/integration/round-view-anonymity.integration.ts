import { requireTestServices } from '@daisy/config';
import { isNamedSeat, type RoomView } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

type Runtime = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Caller = Runtime['host'];

/** A casual room with one seat per side and a judge seat, created by the host. */
const createThreeSeatRoom = async (f: Runtime): Promise<RoomView> => {
  const choice = (await f.operations.catalog(f.host)).find(
    (c) => c.formatId === 'foundation',
  )!;
  return (
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
};

const claimSeat = async (
  f: Runtime,
  view: RoomView,
  who: Caller,
  role: 'affirmative' | 'negative' | 'judge',
): Promise<RoomView> =>
  (await f.command(who, view, { type: 'claim-seat', role, slot: 0 })).view;

const judgeSeatId = async (f: Runtime, roomId: string) => {
  const [seat] = await f.sql<{ id: string }[]>`
    select id from room_participants where room_id=${roomId} and role='judge'`;
  return seat!.id;
};

const usernameOf = async (f: Runtime, userId: string) => {
  const [user] = await f.sql<{ username: string }[]>`
    select username from users where id=${userId}`;
  return user!.username;
};

const leaks = (value: object, hidden: readonly string[]) =>
  hidden.filter((secret) => JSON.stringify(value).includes(secret));

/** The two readers who must not know: a seated debater and a spectator. */
const blindReads = async (
  f: Runtime,
  ownView: (who: Caller) => Promise<RoomView>,
  spectator: Caller,
) => ({
  guest: await ownView(f.guest),
  spectator: await ownView(spectator),
});

const readyAllThenStart = async (
  f: Runtime,
  view: RoomView,
): Promise<RoomView> => {
  // Every caller reads their own projection: the same boundary the page
  // and the API serve. A caller's own seat is always named there, so the
  // ready loop cannot depend on whose projection the last command left.
  for (const who of [f.host, f.guest, f.outsider]) {
    const own = await f.operations.view(who, view.id);
    const seat = own.participants
      .filter(isNamedSeat)
      .find((p) => p.actorId === who.actorId)!;
    if (seat.needsReady) view = (await f.consent(who, own, 'ready')).view;
  }
  return (await f.command(f.host, view, { type: 'start-round' })).view;
};

test('a launched Round names its human judge only to that judge and the host', async () => {
  await withRoomRuntime(async (f) => {
    const judge = f.outsider;
    const spectator = await f.member();
    let view = await createThreeSeatRoom(f);
    view = await claimSeat(f, view, f.host, 'affirmative');
    view = await claimSeat(f, view, f.guest, 'negative');
    view = await claimSeat(f, view, judge, 'judge');
    const roomId = view.id;
    const secrets = [
      judge.actorId,
      await judgeSeatId(f, roomId),
      await usernameOf(f, judge.userId),
    ];
    const ownView = (who: Caller) => f.operations.view(who, roomId);

    const lobby = await blindReads(f, ownView, spectator);
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

    view = await readyAllThenStart(f, view);
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

    const roundId = view.roundRef!.id;
    const [roundJudgeSeat] = await f.sql<{ id: string }[]>`
      select id from round_participants where round_id=${roundId} and role='judge'`;
    const roundSecrets = [
      ...secrets,
      roundJudgeSeat!.id,
      f.host.actorId === judge.actorId ? '' : 'hostActorId',
    ];
    const read = (who: Caller) => f.operations.roundView(who, roundId);
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

test('a host who sits as the human judge stays anonymous with their seat (DEC-174)', async () => {
  await withRoomRuntime(async (f) => {
    const spectator = await f.member();
    let view = await createThreeSeatRoom(f);
    view = await claimSeat(f, view, f.guest, 'affirmative');
    view = await claimSeat(f, view, f.outsider, 'negative');
    view = await claimSeat(f, view, f.host, 'judge');
    const roomId = view.id;
    const hostSecrets = [
      f.host.actorId,
      await judgeSeatId(f, roomId),
      await usernameOf(f, f.host.userId),
    ];
    const ownView = (who: Caller) => f.operations.view(who, roomId);

    const lobby = await blindReads(f, ownView, spectator);
    assert({
      given:
        'the host seated as the human judge, the assembly read by a debater and a spectator',
      should:
        'redact the host identity with the anonymous judge seat: no host actor or label and no judge identity',
      actual: [
        lobby.guest.hostActorId,
        lobby.guest.hostLabel,
        lobby.spectator.hostActorId,
        lobby.spectator.hostLabel,
        leaks(lobby.guest, hostSecrets),
        leaks(lobby.spectator, hostSecrets),
      ],
      expected: [null, null, null, null, [], []],
    });
    const hostLobby = await ownView(f.host);
    assert({
      given:
        'the same assembly read by the host who sits as its judge (negative control)',
      should: 'keep their host identity and name their own judge seat',
      actual: [
        hostLobby.hostActorId,
        hostLobby.hostLabel,
        leaks(hostLobby, hostSecrets).length > 0,
      ],
      expected: [f.host.actorId, hostSecrets[2]!, true],
    });

    view = await readyAllThenStart(f, view);
    const read = (who: Caller) =>
      f.operations.roundView(who, view.roundRef!.id);
    assert({
      given: 'a launched Round whose judge is its host, read by a debater',
      should: 'carry no judge actor and no host actor at all',
      actual: [leaks(await read(f.guest), [...hostSecrets, 'hostActorId'])],
      expected: [[]],
    });
  });
});
