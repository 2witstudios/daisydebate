import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
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
import { roomPermissions, vendorPermissions } from './permissions';

type RoomService = Pick<
  RoomServiceClient,
  | 'listRooms'
  | 'createRoom'
  | 'deleteRoom'
  | 'listParticipants'
  | 'updateParticipant'
>;

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
      requestTimeout: 5,
      failover: false,
    });
  const operation = async <T>(work: () => Promise<T>) => {
    try {
      return await work();
    } catch {
      throw createAppError('INFRASTRUCTURE', 'Media service operation failed');
    }
  };
  return {
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
      await operation(() => client.deleteRoom(name));
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
    async participants(room: string) {
      const name = parseMedia(idSchema, room);
      return operation(async () =>
        (await client.listParticipants(name)).map((participant) =>
          parseMedia(participantSchema, participant),
        ),
      );
    },
  };
}
