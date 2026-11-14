import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  authorizationCapabilitySchema,
  permissionSchema,
} from './authorization';
import {
  authorizationResourceKindSchema,
  capabilityMetadata,
} from './capability-metadata';

setupRitewayBun();

const capabilities = authorizationCapabilitySchema.options;
const kinds: readonly string[] = authorizationResourceKindSchema.options;
const where = (keep: (capability: (typeof capabilities)[number]) => boolean) =>
  capabilities.filter(keep);

describe('capability metadata', () => {
  test('every capability can be read from the protocol alone', () => {
    assert({
      given: 'the capability list and the metadata table',
      should: 'have one complete row per capability and no other row',
      actual: {
        rows: Object.keys(capabilityMetadata).sort(),
        incomplete: where((capability) => {
          const row = capabilityMetadata[capability];
          return !(
            row.resourceKinds.length > 0 &&
            row.resourceKinds.every((kind) => kinds.includes(kind)) &&
            [row.read, row.grantable, row.conflictSensitive].every(
              (flag) => typeof flag === 'boolean',
            ) &&
            ['lobby', 'person', null].includes(row.reach) &&
            ['standing', 'tournament', null].includes(row.lobbyKind) &&
            ['league', 'school', null].includes(row.organizationKind)
          );
        }),
      },
      expected: { rows: [...capabilities].sort(), incomplete: [] },
    });
    assert({
      given: 'every resource kind',
      should: 'be one some capability is asked of',
      actual: kinds.filter(
        (kind) =>
          !capabilities.some((capability) =>
            (
              capabilityMetadata[capability].resourceKinds as readonly string[]
            ).includes(kind),
          ),
      ),
      expected: [],
    });
  });

  test('a permission is exactly a grantable capability', () => {
    assert({
      given: 'the grantable rows',
      should: 'be the fifteen permissions a role may hold',
      actual: where((capability) => capabilityMetadata[capability].grantable),
      expected: [...permissionSchema.options],
    });
  });

  test('conflict, lobby kind and organization kind are named per capability', () => {
    assert({
      given: 'the table',
      should:
        'name the conflict-sensitive capabilities, the standing-only one and the school-only ones',
      actual: {
        conflictSensitive: where(
          (capability) => capabilityMetadata[capability].conflictSensitive,
        ),
        standing: where(
          (capability) =>
            capabilityMetadata[capability].lobbyKind === 'standing',
        ),
        school: where(
          (capability) =>
            capabilityMetadata[capability].organizationKind === 'school',
        ),
        tournamentNamedButEither: where(
          (capability) =>
            capability.startsWith('tournament.') &&
            capabilityMetadata[capability].lobbyKind !== 'tournament',
        ),
      },
      expected: {
        conflictSensitive: [
          'round.observe.undelayed',
          'room.manage',
          'tournament.draw.edit',
          'tournament.rooms.officiate',
          'tournament.results.enter',
          'tournament.ballots.read_unreleased',
        ],
        standing: ['lobby.room.create'],
        school: ['school.roster.manage', 'school.ballots.read'],
        tournamentNamedButEither: [],
      },
    });
  });

  test('reach says what a minor’s boundary bounds', () => {
    assert({
      given: 'the reach column',
      should:
        'put every lobby read and join, every permission and everything decided through one under the lobby, and every approach to another person under the person',
      actual: {
        lobby: where(
          (capability) => capabilityMetadata[capability].reach === 'lobby',
        ),
        person: where(
          (capability) => capabilityMetadata[capability].reach === 'person',
        ),
      },
      expected: {
        lobby: [
          'round.read',
          'round.observe.undelayed',
          'room.create',
          'room.list',
          'room.read',
          'room.join',
          'room.manage',
          ...permissionSchema.options,
          'organization.host.read',
          'lobby.read',
          'lobby.host.read',
          'lobby.room.create',
          'judge.invitation.respond',
          'judge.availability.update',
          'posting.read',
          'result.read',
          'ballot.read',
          'standings.read',
          'resolution.read',
          'sanction.read',
        ],
        person: [
          'social.friend.request',
          'social.challenge.send',
          'social.challenge.accept',
          'channel.dm.request',
          'channel.create.private_group',
          'member.history.read',
          'channel.group.invite',
          'channel.invitation.accept',
          'channel.request.decide',
        ],
      },
    });
  });
});
