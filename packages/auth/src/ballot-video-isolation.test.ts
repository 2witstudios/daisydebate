import { assert, setupRitewayBun, test } from 'riteway/bun';
import { audienceDecision } from './authorization-audience';
import {
  ask,
  eventRoom,
  eventRound,
  hosted,
  leagueTournament,
  lobbyFact,
  lobbyGrant,
  noConflict,
  NOW,
  permissions,
} from './lobby.test-support';
import type {
  ViewingFact,
  VideoSubjectsFact,
} from './authorization-lobby-facts';

setupRitewayBun();

test('ballot-only authority grants no unreleased video through any event or recordings path', () => {
  const viewers = Array.from({ length: 8 }, (_, bits) =>
    (['responsible_adults', 'competitors', 'participants'] as const).filter(
      (_, i) => bits & (1 << i),
    ),
  );
  const failures: unknown[] = [];
  for (const scope of [hosted, leagueTournament])
    for (const held of [
      ['tournament.ballots.read_unreleased'] as const,
      permissions.filter(
        (permission) => permission !== 'tournament.rooms.officiate',
      ),
    ])
      for (const audiences of viewers)
        for (const minorSeated of [false, true])
          for (const guardianCap of ['lobby', 'officials'] as const) {
            const viewing: ViewingFact = {
              audiences,
              releases: [
                { thing: 'posting', audience: 'public' },
                { thing: 'decision', audience: 'public' },
                { thing: 'scores', audience: 'participants' },
                { thing: 'reason', audience: 'participants' },
                { thing: 'feedback', audience: 'participants' },
              ] as const,
            };
            const video: VideoSubjectsFact = { minorSeated, guardianCap };
            const grants = [lobbyGrant(scope.lobbyId, held)];
            const actual = [
              ask('lobby.host.recordings.read', lobbyFact(scope), { grants })
                .allow,
              ask('room.read', eventRoom({ scope, viewing, video }), { grants })
                .allow,
              ask('round.read', eventRound({ scope, viewing, video }), {
                grants,
              }).allow,
              ask(
                'round.observe.undelayed',
                eventRound({ scope, viewing, video }),
                { grants },
              ).allow,
              audienceDecision(
                { actorId: 'person', ageBand: 'adult', grants, now: NOW },
                scope,
                'video',
                viewing,
                noConflict,
                video,
              ).allow,
            ];
            if (actual.some(Boolean))
              failures.push({
                scope: scope.lobbyId,
                held,
                audiences,
                video,
                actual,
              });
          }
  assert({
    given:
      'both event ownership shapes, every member audience, adult/minor and guardian caps, and ballot or unrelated permissions without officiating',
    should:
      'grant no video by recordings-area, Room, Round, undelayed or direct audience fallback',
    actual: failures,
    expected: [],
  });
});

test('official video still belongs to actual owners and covering officiators while public video remains an audience right', () => {
  const viewing: ViewingFact = { audiences: [], releases: [] };
  const actual = [hosted, leagueTournament].flatMap((scope) => {
    const owner =
      scope.owner.kind === 'person'
        ? scope.owner.actorId
        : scope.owner.organization.ownerActorIds[0]!;
    const officiator = {
      grants: [lobbyGrant(scope.lobbyId, ['tournament.rooms.officiate'])],
    };
    return [
      ask('room.read', eventRoom({ scope, viewing }), { actorId: owner }).allow,
      ask('round.read', eventRound({ scope, viewing }), officiator).allow,
      ask('round.read', eventRound({ scope, viewing }), {
        grants: [lobbyGrant('elsewhere', ['tournament.rooms.officiate'])],
      }).allow,
      ask(
        'round.read',
        eventRound({
          scope,
          viewing: {
            audiences: [],
            releases: [{ thing: 'video', audience: 'public' }],
          },
        }),
      ).allow,
    ];
  });
  assert({
    given:
      'an unreleased event video and a separately recorded public adult release',
    should:
      'preserve owner/covering officiator authority, refuse a foreign grant and preserve the public audience',
    actual,
    expected: [true, true, false, true, true, true, false, true],
  });
});
