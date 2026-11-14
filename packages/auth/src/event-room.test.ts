import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorizationCapabilitySchema } from '@daisy/protocol/authorization';
import { capabilityMetadata } from '@daisy/protocol/capability-metadata';
import { allowFixed, allowUnder, deny } from './authorization-decision';
import { roomAllowed, roundAllowed } from './authorization-room';
import {
  asEventScope,
  ask,
  eventRoom,
  eventRound,
  leagueTournament,
  lobbyGrant,
  organizationGrant,
  permissions,
  room,
  round,
  standing,
  type Asker,
} from './lobby.test-support';

setupRitewayBun();

const capabilitiesOf = (kind: 'room' | 'round') =>
  authorizationCapabilitySchema.options.filter((capability) =>
    capabilityMetadata[capability].resourceKinds.includes(kind),
  );
const people: Record<string, Asker> = {
  owner: { actorId: 'host' },
  officiator: {
    grants: [lobbyGrant('hosted', ['tournament.rooms.officiate'])],
  },
  'officiator at another lobby': {
    grants: [lobbyGrant('elsewhere', ['tournament.rooms.officiate'])],
  },
  'staff without officiating': {
    grants: [
      lobbyGrant(
        'hosted',
        permissions.filter((held) => held !== 'tournament.rooms.officiate'),
      ),
    ],
  },
  'league staff': { grants: [organizationGrant('league', permissions)] },
  seat: { actorId: 'seat' },
  judge: { actorId: 'judge' },
  stranger: {},
};
const who = (decide: (asker: Asker) => { readonly allow: boolean }) =>
  Object.keys(people).filter((person) => decide(people[person]!).allow);

describe('an event Room', () => {
  test('is managed and watched undelayed by every officiator and nobody else', () => {
    assert({
      given:
        'a person-hosted tournament’s Room, asked by its owner, staff, seats and strangers',
      should:
        'allow exactly the owner and the holder of a covering officiate grant',
      actual: {
        manage: who((asker) => ask('room.manage', eventRoom(), asker)),
        observe: who((asker) =>
          ask('round.observe.undelayed', eventRound(), asker),
        ),
      },
      expected: {
        manage: ['owner', 'officiator'],
        observe: ['owner', 'officiator'],
      },
    });
    assert({
      given: 'two officiators of one Room',
      should: 'name each one’s own grant, so the host is whoever holds one',
      actual: ['grant-a', 'grant-b'].map((grantId) =>
        ask('room.manage', eventRoom(), {
          grants: [
            lobbyGrant('hosted', ['tournament.rooms.officiate'], { grantId }),
          ],
        }),
      ),
      expected: ['grant-a', 'grant-b'].map((grantId) =>
        allowUnder({ kind: 'grant', grantId }),
      ),
    });
  });

  test('is read by its seats and its staff, and joined only by its seats', () => {
    assert({
      given:
        'the same people asking to read, join, ready and read the transcript',
      should:
        'let seats and officiating or official staff read, and only seats sit',
      actual: {
        read: who((asker) => ask('room.read', eventRoom(), asker)),
        round: who((asker) => ask('round.read', eventRound(), asker)),
        join: who((asker) => ask('room.join', eventRoom(), asker)),
        ready: who((asker) => ask('room.ready', eventRoom(), asker)),
        transcript: who((asker) =>
          ask('round.transcript.read', eventRound(), asker),
        ),
        analysis: who((asker) =>
          ask('round.analysis.read', eventRound(), asker),
        ),
      },
      expected: {
        read: [
          'owner',
          'officiator',
          'staff without officiating',
          'seat',
          'judge',
        ],
        round: [
          'owner',
          'officiator',
          'staff without officiating',
          'seat',
          'judge',
        ],
        join: ['seat', 'judge'],
        ready: ['seat', 'judge'],
        transcript: ['seat', 'judge'],
        analysis: ['seat'],
      },
    });
  });
});

describe('an ordinary Room', () => {
  const actors = ['creator', 'seat', 'judge', 'stranger'];
  const visibilities = ['public', 'unlisted', 'private'] as const;
  const owners = [{}, { owner: { kind: 'person' as const, scope: standing } }];
  test('decides every Room capability exactly as the single-host rule', () => {
    const cases = capabilitiesOf('room').flatMap((capability) =>
      visibilities.flatMap((visibility) =>
        owners.flatMap((owner) =>
          actors.map((actorId) => ({
            capability,
            actorId,
            fact: room({ visibility, ...owner }),
          })),
        ),
      ),
    );
    assert({
      given:
        'every Room capability, visibility and person, with and without the lobby loaded',
      should:
        'answer as the rule before lobbies did, with staff grants changing nothing',
      actual: cases.map(
        ({ capability, actorId, fact }) =>
          ask(capability, fact, {
            actorId,
            grants: [organizationGrant('league', permissions)],
          }).allow,
      ),
      expected: cases.map(({ capability, actorId, fact }) =>
        roomAllowed(actorId, capability, fact),
      ),
    });
  });
  test('decides every Round capability exactly as before', () => {
    const cases = capabilitiesOf('round').flatMap((capability) =>
      (['completed', 'live'] as const).flatMap((status) =>
        owners.flatMap((owner) =>
          actors.map((actorId) => ({
            capability,
            actorId,
            fact: round({ status, ...owner }),
          })),
        ),
      ),
    );
    assert({
      given: 'every Round capability, status and person',
      should:
        'answer as the rule before lobbies did, under a fixed rule with no conflict',
      actual: cases.map(({ capability, actorId, fact }) =>
        ask(capability, fact, { actorId }),
      ),
      expected: cases.map(({ capability, actorId, fact }) =>
        roundAllowed(actorId, capability, fact)
          ? allowFixed
          : deny('missing-capability'),
      ),
    });
  });
});

describe('an event Room outside a tournament', () => {
  test('cannot be written, and is refused if a loader writes it anyway', () => {
    const officiator = {
      grants: [organizationGrant('league', ['tournament.rooms.officiate'])],
    };
    const misplaced = eventRoom({
      // @ts-expect-error an event Room's lobby is a tournament: a standing lobby does not typecheck.
      scope: standing,
    });
    assert({
      given:
        'a league officiator asked about an event Room and Round placed in the league’s standing lobby, and in its tournament',
      should:
        'deny every question about the misplaced ones and still allow the tournament’s',
      actual: [
        ask('room.manage', misplaced, officiator),
        ask('room.read', misplaced, officiator),
        ask(
          'round.observe.undelayed',
          eventRound({ scope: asEventScope(standing) }),
          officiator,
        ),
        ask('room.manage', eventRoom({ scope: leagueTournament }), officiator)
          .allow,
      ],
      expected: [
        ...Array(3).fill({ allow: false, reason: 'denied', conflict: null }),
        true,
      ],
    });
  });
  test('an officiator is an official for a guardian’s video cap', () => {
    const capped = {
      video: { minorSeated: true, guardianCap: 'officials' as const },
    };
    const officiator = {
      grants: [lobbyGrant('hosted', ['tournament.rooms.officiate'])],
    };
    assert({
      given:
        'a Room whose seated ward is capped at officials, read by an officiator and by a stranger it is released to',
      should: 'show it to the officiator who runs it and not to the stranger',
      actual: [
        ask('room.read', eventRoom(capped), officiator).allow,
        ask('round.read', eventRound(capped), officiator).allow,
        ask(
          'room.read',
          eventRoom({
            ...capped,
            viewing: {
              audiences: [],
              releases: [{ thing: 'video', audience: 'public' }],
            },
          }),
        ).allow,
      ],
      expected: [true, true, false],
    });
  });
});
