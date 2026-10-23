import { createMediaService } from '@daisy/media';

export type Grants = {
  publish: ('camera' | 'microphone')[];
  subscribe: boolean;
  hidden: boolean;
};
export type Vendor =
  'listRooms' | 'createRoom' | 'deleteRoom' | 'updateParticipant';
const sources = { camera: 1, microphone: 2 } as const;

/** The real media adapter over an in-memory self-hosted LiveKit room service. */
export function createMediaVendor({
  journal,
  rooms,
  connected,
  fail,
}: {
  readonly journal: string[];
  readonly rooms: Set<string>;
  readonly connected: Map<string, Grants>;
  readonly fail: (call: Vendor) => Promise<void>;
}) {
  return createMediaService({
    config: {
      url: 'http://127.0.0.1:7880',
      apiKey: 'daisy-unit',
      apiSecret: 'unit-only-livekit-secret-of-sufficient-length',
    },
    rooms: {
      listRooms: async (names?: string[]) => {
        await fail('listRooms');
        return [...rooms]
          .filter((name) => !names || names.includes(name))
          .map((name) => ({ name }));
      },
      createRoom: async ({ name }: { name: string }) => {
        journal.push('create');
        await fail('createRoom');
        rooms.add(name);
        return { name };
      },
      deleteRoom: async (name: string) => {
        journal.push('delete');
        await fail('deleteRoom');
        rooms.delete(name);
        connected.clear();
      },
      listParticipants: async () =>
        [...connected].map(([identity, grants]) => ({
          identity,
          permission: {
            canPublish: grants.publish.length > 0,
            canSubscribe: grants.subscribe,
            canPublishData: false,
            canPublishSources: grants.publish.map((s) => sources[s]),
            canUpdateMetadata: false,
            hidden: grants.hidden,
          },
        })),
      updateParticipant: async (
        _room: string,
        identity: string,
        update: {
          permission: {
            canSubscribe: boolean;
            canPublishSources: number[];
            hidden: boolean;
          };
        },
      ) => {
        const publish = (['camera', 'microphone'] as const).filter((s) =>
          update.permission.canPublishSources.includes(sources[s]),
        );
        journal.push(`permissions:${identity}:${publish.join('+') || '-'}`);
        await fail('updateParticipant');
        connected.set(identity, {
          publish: [...publish],
          subscribe: update.permission.canSubscribe,
          hidden: update.permission.hidden,
        });
      },
    } as unknown as NonNullable<
      Parameters<typeof createMediaService>[0]['rooms']
    >,
  });
}
