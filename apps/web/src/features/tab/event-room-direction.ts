import {
  authorize,
  type AuthorizationCapability,
  type RoomAuthorizationFact,
  type RoomOwnerFact,
} from '@daisy/auth/authorization';
import type { RoomDirectionInput } from '@daisy/db/tab';
import type { RoomAssemblyState } from '@daisy/protocol';
import { eventSettingResolution } from './operations/event-setting-resolution';

/** Relationships belong to the addressed fixture, including school authority. */
export const eventFixtureAudiences = (
  input: Pick<RoomDirectionInput, 'authorization' | 'audience'>,
  now: string,
) => [
  ...(input.authorization.account?.ageBand === 'adult' &&
  (input.audience.responsibleAdult ||
    input.audience.schools.some(
      (school) =>
        school.organization &&
        school.account?.actorId &&
        authorize({
          principal: {
            kind: 'user',
            userId: school.account.userId,
            actorId: school.account.actorId,
          },
          capability: 'school.roster.manage',
          resource: school.organization,
          context: {
            account: school.account,
            grants: school.grants,
            now,
          },
        }).allow,
    ))
    ? ['responsible_adults' as const]
    : []),
  ...(input.audience.ownEntry ? ['competitors' as const] : []),
  ...(input.audience.participant ? ['participants' as const] : []),
];

export const eventRoomOwner = (
  input: RoomDirectionInput,
  now: string,
): Extract<RoomOwnerFact, { kind: 'event' }> | null => {
  const { lobby } = input.configuration;
  const organization = input.authorization.organization;
  const owner = organization
    ? { kind: 'organization' as const, organization }
    : input.ownerActorId
      ? { kind: 'person' as const, actorId: input.ownerActorId }
      : null;
  if (!owner) return null;
  return {
    kind: 'event',
    fixtureId: input.fixtureId,
    scope: { lobbyId: lobby.id, lobbyKind: 'tournament', owner },
    conflict: {
      connections: input.connections,
      handling: eventSettingResolution(input.configuration).settings[
        'conflict.handling'
      ].value.value,
      waiverId: input.readWaiverId,
    },
    viewing: {
      audiences: eventFixtureAudiences(input, now),
      releases: input.audience.releases,
    },
    video: { minorSeated: false, guardianCap: 'officials' },
  };
};

/** Current Tab authority exported to ordinary Room commands, never a substitute host. */
export const eventRoomDirectionDecision = (
  caller: { readonly userId: string; readonly actorId: string },
  capability: AuthorizationCapability,
  room: Pick<
    RoomAssemblyState,
    'id' | 'hostActorId' | 'visibility' | 'status' | 'version'
  > & { readonly participants: RoomAuthorizationFact['participants'] },
  input: RoomDirectionInput,
  now: string,
) => {
  const owner = eventRoomOwner(input, now);
  if (!owner) return null;
  const resource: RoomAuthorizationFact = {
    kind: 'room',
    roomId: room.id,
    hostActorId: room.hostActorId,
    visibility: room.visibility,
    status: room.status,
    revision: room.version,
    participants: room.participants,
    owner: { ...owner, conflict: { ...owner.conflict, waiverId: null } },
  };
  return authorize({
    principal: { kind: 'user', ...caller },
    capability,
    resource,
    context: {
      account: input.authorization.account,
      grants: input.authorization.grants,
      now,
    },
  });
};

/** Boolean adapter for ordinary Room reads and command gates. */
export const eventRoomAuthority = (
  ...input: Parameters<typeof eventRoomDirectionDecision>
) => eventRoomDirectionDecision(...input)?.allow ?? false;
