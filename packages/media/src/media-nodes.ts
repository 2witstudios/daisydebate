import { createAppError, isAppError } from '@daisy/errors';
import { createMediaService } from './service';

export type MediaNode = {
  /** The server API. */
  readonly url: string;
  /** Where a browser connects. */
  readonly publicUrl: string;
};
type NodeService = ReturnType<typeof createMediaService>;
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const PROBE_TIMEOUT_MS = 1_000;

/** Where a client joins: a room's URLs stay stable for as long as its node list does. */
const stableIndex = (room: string, size: number) => {
  let hash = 0;
  for (const char of room) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % size;
};

const httpRouteOf = (publicUrl: string) => {
  const route = new URL(publicUrl);
  route.protocol = route.protocol === 'wss:' ? 'https:' : 'http:';
  return route.toString();
};

const workerUrlOf = (url: string) => {
  const worker = new URL(url);
  worker.protocol = worker.protocol === 'https:' ? 'wss:' : 'ws:';
  return worker.toString();
};

/**
 * Several LiveKit nodes as one media service. A read asks each healthy node in
 * turn, since asking twice changes nothing. A write goes to one, because a second
 * attempt could not tell what the first did. Any node reaches any room through
 * LiveKit's Redis, so health only says which node to ask. With no healthy node
 * every node is tried: a probe can be wrong, and being wrong must not end media.
 */
export function createMediaNodes(input: {
  readonly nodes: readonly MediaNode[];
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly fetch: Fetch;
  /** A node's health moved; its index only, never its address. */
  readonly healthChanged?: (nodeIndex: number, healthy: boolean) => void;
  /** One per node, for tests; the real SDK client otherwise. */
  readonly services?: readonly NodeService[];
}) {
  const [first] = input.nodes;
  if (!first) throw createAppError('VALIDATION', 'No media node is configured');
  const services =
    input.services ??
    input.nodes.map(({ url }) =>
      createMediaService({
        config: { url, apiKey: input.apiKey, apiSecret: input.apiSecret },
      }),
    );
  const healthy = input.nodes.map(() => true);
  const inOrder = () => {
    const up = services.flatMap((_, index) => (healthy[index] ? [index] : []));
    return up.length ? up : services.map((_, index) => index);
  };
  const preferred = () => services[inOrder()[0]!]!;
  const read = async <T>(work: (service: NodeService) => Promise<T>) => {
    let failure: unknown;
    // A probe can be stale: the rest are asked once the healthy ones have faulted.
    const healthyFirst = [
      ...new Set([...inOrder(), ...services.map((_, index) => index)]),
    ];
    for (const index of healthyFirst)
      try {
        return await work(services[index]!);
      } catch (error) {
        // A node's definite answer is the answer. Only a fault moves to the next.
        if (isAppError(error) && error.code !== 'INFRASTRUCTURE') throw error;
        failure = error;
      }
    throw failure;
  };
  return {
    exists: (room: string) => read((service) => service.exists(room)),
    publicationPermissions: (room: string) =>
      read((service) => service.publicationPermissions(room)),
    participants: (room: string) =>
      read((service) => service.participants(room)),
    joinToken: (join: Parameters<NodeService['joinToken']>[0]) =>
      services[0]!.joinToken(join),
    createRoom: (room: string) => preferred().createRoom(room),
    deleteRoom: (room: string) => preferred().deleteRoom(room),
    permissions: (...args: Parameters<NodeService['permissions']>) =>
      preferred().permissions(...args),
    size: input.nodes.length,
    /** Every node's index, healthy ones first, for another client of the same nodes. */
    order: () => [
      ...new Set([...inOrder(), ...services.map((_, index) => index)]),
    ],
    /** Where a client joins this room now: on a healthy node, the same one each time. */
    urlsFor(room: string) {
      const up = inOrder();
      const node = input.nodes[up[stableIndex(room, up.length)]!]!;
      return { publicUrl: node.publicUrl, workerUrl: workerUrlOf(node.url) };
    },
    /** Asks every node's API and public route once. LiveKit answers on `/` once it serves. */
    async probe() {
      await Promise.all(
        input.nodes.map(async ({ url, publicUrl }, index) => {
          const answers = (route: string) =>
            input
              .fetch(new URL('/', route).toString(), {
                signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
              })
              .then(
                async (response) => {
                  await response.body?.cancel();
                  return response.ok;
                },
                () => false,
              );
          // Browsers join the public route, so it must answer as well as the API.
          const [api, joinable] = await Promise.all([
            answers(url),
            answers(httpRouteOf(publicUrl)),
          ]);
          if (healthy[index] !== (api && joinable))
            input.healthChanged?.(index, api && joinable);
          healthy[index] = api && joinable;
        }),
      );
    },
  };
}
export type MediaNodes = ReturnType<typeof createMediaNodes>;
