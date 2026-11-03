import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  AccessToken,
  RoomServiceClient,
  ServerError,
} from 'livekit-server-sdk';
import {
  configSchema,
  joinSchema,
  parseMedia,
  participantSchema,
  permissionSchema,
  type MediaConfig,
  type MediaJoin,
  type MediaPermissions,
} from './contracts';
import {
  roomPermissions,
  vendorPermissions,
  publicationPermission,
} from './permissions';

type RoomService = Pick<
  RoomServiceClient,
  | 'listRooms'
  | 'createRoom'
  | 'deleteRoom'
  | 'listParticipants'
  | 'updateParticipant'
>;

/** How long one vendor call may take before the SDK gives up on it. */
export const MEDIA_CALL_TIMEOUT_MS = 5_000;

/**
 * A 4xx LiveKit response is a definite refusal (not found, or otherwise refused). A
 * timeout (408 or deadline_exceeded) may still have applied, so it stays unknown, like a
 * network failure or 5xx.
 */
const definiteRefusal = (error: unknown): error is ServerError =>
  error instanceof ServerError &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 408 &&
  error.code !== 'deadline_exceeded';

/** What round media asks of a vendor, through one node or a list of them. */
export type MediaVendor = ReturnType<typeof createMediaService>;

/** All credentials are injected; the SDK's environment fallback is never used. */
export function createMediaService({
  config,
  rooms,
}: {
  readonly config?: MediaConfig;
  readonly rooms?: RoomService;
}) {
  const settings = parseMedia(configSchema, config, true);
  const client =
    rooms ??
    new RoomServiceClient(settings.url, settings.apiKey, settings.apiSecret, {
      requestTimeout: MEDIA_CALL_TIMEOUT_MS / 1_000,
      failover: false,
    });
  const operation = async <T>(work: () => Promise<T>) => {
    try {
      return await work();
    } catch (error) {
      if (definiteRefusal(error))
        throw createAppError(
          error.status === 404 || error.code === 'not_found'
            ? 'NOT_FOUND'
            : 'CONFLICT',
          'Media service refused the operation',
        );
      throw createAppError('INFRASTRUCTURE', 'Media service operation failed');
    }
  };
  const participants = async (room: string) => {
    const name = parseMedia(idSchema, room);
    return operation(async () =>
      (await client.listParticipants(name)).map((participant) =>
        parseMedia(participantSchema, participant),
      ),
    );
  };
  return {
    async exists(room: string) {
      const name = parseMedia(idSchema, room);
      return operation(async () =>
        (await client.listRooms([name])).some((room) => room.name === name),
      );
    },
    /** LiveKit's id for the room, which changes if it is rebuilt on another node. */
    async roomSid(room: string) {
      const name = parseMedia(idSchema, room);
      return operation(async () => {
        const found = (await client.listRooms([name])).find(
          (entry) => entry.name === name,
        );
        return found ? found.sid || name : null;
      });
    },
    async publicationPermissions(room: string) {
      return (await participants(room)).map(publicationPermission);
    },
    async joinToken(input: MediaJoin) {
      const value = parseMedia(joinSchema, input);
      return operation(async () => {
        const token = new AccessToken(settings.apiKey, settings.apiSecret, {
          identity: value.identity,
          ttl: 60,
        });
        token.name = '';
        if (value.capture) token.kind = 'agent';
        token.addGrant({
          roomJoin: true,
          room: value.room,
          ...vendorPermissions(value),
        });
        return token.toJwt();
      });
    },
    async createRoom(room: string) {
      const name = parseMedia(idSchema, room);
      await operation(async () => {
        if (!(await client.listRooms([name])).length)
          await client.createRoom({ name });
      });
    },
    async deleteRoom(room: string) {
      const name = parseMedia(idSchema, room);
      await operation(async () => {
        try {
          await client.deleteRoom(name);
        } catch (error) {
          // A room on a dead node stays listed and cannot be deleted until a create
          // moves it to a live one, so its delete is a create and a delete (ADR 0110).
          if (!(error instanceof ServerError) || definiteRefusal(error))
            throw error;
          await client.createRoom({ name });
          await client.deleteRoom(name);
        }
      });
    },
    async permissions(room: string, identity: string, input: MediaPermissions) {
      const name = parseMedia(idSchema, room);
      const actor = parseMedia(idSchema, identity);
      const grants = parseMedia(permissionSchema, input);
      await operation(() =>
        client.updateParticipant(name, actor, {
          permission: roomPermissions(grants),
          name: '',
        }),
      );
    },
    participants,
  };
}
