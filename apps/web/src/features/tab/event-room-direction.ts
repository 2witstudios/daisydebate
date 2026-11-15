import {
  authorize,
  type AuthorizationCapability,
  type RoomAuthorizationFact,
} from '@daisy/auth/authorization';
import type { RoomDirectionInput } from '@daisy/db/tab';
import type { RoomAssemblyState } from '@daisy/protocol';
import { eventSettingResolution } from './operations/event-setting-resolution';

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
  const { lobby } = input.configuration;
  const organization = input.authorization.organization;
  const owner = organization
    ? { kind: 'organization' as const, organization }
    : input.ownerActorId
      ? { kind: 'person' as const, actorId: input.ownerActorId }
      : null;
  if (!owner) return null;
  const resource: RoomAuthorizationFact = {
    kind: 'room',
    roomId: room.id,
    hostActorId: room.hostActorId,
    visibility: room.visibility,
    status: room.status,
    revision: room.version,
    participants: room.participants,
    owner: {
      kind: 'event',
      fixtureId: input.fixtureId,
      scope: { lobbyId: lobby.id, lobbyKind: 'tournament', owner },
      conflict: {
        connections: input.connections,
        handling: eventSettingResolution(input.configuration).settings[
          'conflict.handling'
        ].value.value,
        waiverId: null,
      },
      viewing: { audiences: [], releases: [] },
      video: { minorSeated: false, guardianCap: 'officials' },
    },
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
