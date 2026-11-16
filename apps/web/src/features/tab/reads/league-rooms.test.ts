import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readLeagueRooms } from './league-rooms';
setupRitewayBun();
test('own standing Room projection retains actual roles and native links', () => {
  const facts = {
    standingLobby: {
      id: 'lobby',
      kind: 'standing',
      name: 'League lobby',
      closedAt: null,
    },
    organization: { id: 'league' },
    authorization: {
      membership: 'active',
      organization: {
        kind: 'organization',
        organizationId: 'league',
        organizationKind: 'league',
        ownerActorIds: [],
        member: true,
        standingLobbyIds: ['lobby'],
      },
      account: null,
      grants: [],
    },
    standingPostingSettings: [],
    now: '2027-03-06T10:00:00.000Z',
    standingRooms: [
      {
        id: 'room',
        title: 'Actual Room',
        formatId: 'freestyle',
        status: 'started',
        rulesSnapshot: {
          sides: [{ key: 'affirmative' }, { key: 'negative' }],
          seats: {
            sides: { affirmative: 1, negative: 1 },
            speakers: 0,
            judges: 1,
            moderators: 0,
          },
        },
      },
    ],
    standingParticipants: [
      {
        roomId: 'room',
        actorId: 'judge',
        seatKind: 'judge',
        username: 'Actual judge',
      },
    ],
    standingRounds: [
      { roomId: 'room', id: 'round', status: 'active', currentStage: null },
    ],
  };
  const view = readLeagueRooms(
    facts as never,
    { kind: 'user', userId: 'user', actorId: 'judge' },
    (() => ({ allow: true })) as never,
  );
  const action = view?.panel.groups[0]?.rooms[0]?.action;
  assert({
    given: 'the viewer actually seated as judge in a live standing-lobby Room',
    should:
      'pin their actual role and ordinary live destination without serializing rules',
    actual: [
      view?.panel.groups[0]?.heading,
      view?.panel.groups[0]?.rooms[0]?.detail,
      action?.kind === 'link' ? action.href : null,
      JSON.stringify(view).includes('rulesSnapshot'),
    ],
    expected: [
      'Your room',
      'freestyle · You are judging · Live · 2 debater seats open',
      '/rounds/round/room',
      false,
    ],
  });
  assert({
    given: 'the current authority denies room.list',
    should: 'return no Room list',
    actual: readLeagueRooms(
      facts as never,
      { kind: 'user', userId: 'user', actorId: 'judge' },
      (() => ({ allow: false })) as never,
    ),
    expected: null,
  });
});
