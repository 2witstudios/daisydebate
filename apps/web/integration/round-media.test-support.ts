import { createId } from '@paralleldrive/cuid2';
import { createMediaService } from '@daisy/media';
import { createLogger } from '@daisy/logger';
import { noopErrorReporter, withTimeout } from '@daisy/observability';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { withRoomRuntime } from './room-runtime.test-support';

const localMediaConfig = {
  url: 'http://127.0.0.1:7880',
  apiKey: 'daisy-local',
  apiSecret: 'local-development-only-livekit-secret',
};
export const mediaDependencies = (
  fixture: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
  media = createMediaService({ config: localMediaConfig }),
) => ({
  store: fixture.store.mediaSessions,
  media,
  publicUrl: 'wss://localhost.invalid',
  workerUrl: 'ws://127.0.0.1:7880',
  nextId: createId,
  reporter: noopErrorReporter,
  logger: createLogger({ service: 'round-media-proof', level: 'silent' }),
  deadline: <T>(work: Promise<T>) => withTimeout(work, 2000),
  wait: () => Bun.sleep(10),
});
export const withMediaRound = (
  work: (
    fixture: Parameters<Parameters<typeof withRoomRuntime>[0]>[0] & {
      readonly roundId: string;
      readonly media: ReturnType<typeof createMediaService>;
      readonly mediaOperations: ReturnType<typeof createRoundMediaOperations>;
    },
  ) => Promise<void>,
) =>
  withRoomRuntime(async (fixture) => {
    const assembled = await fixture.assemble();
    const launched = await fixture.command(fixture.host, assembled, {
      type: 'start-round',
    });
    const roundId = launched.view.roundRef!.id;
    const deps = mediaDependencies(fixture);
    try {
      await work({
        ...fixture,
        roundId,
        media: deps.media,
        mediaOperations: createRoundMediaOperations(deps),
      });
    } finally {
      const [session] =
        await fixture.sql`select room_name from media_sessions where round_id=${roundId}`;
      if (session && (await deps.media.exists(session.room_name)))
        await deps.media.deleteRoom(session.room_name);
    }
  });
export const tokenClaims = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
    sub: string;
    name: string;
    kind?: string;
    exp: number;
    nbf: number;
    video: Record<string, unknown>;
  };

/** Delay an actual provider acknowledgement after its committed effect, without replacing the vendor. */
export function delayedMediaCreation() {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let delayed = false;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const response = await fetch(`${localMediaConfig.url}${url.pathname}`, {
        method: request.method,
        headers: request.headers,
        body: await request.arrayBuffer(),
      });
      if (!delayed && url.pathname.endsWith('/CreateRoom') && response.ok) {
        delayed = true;
        entered.resolve();
        await release.promise;
      }
      return response;
    },
  });
  return {
    config: { ...localMediaConfig, url: `http://127.0.0.1:${server.port}` },
    entered: entered.promise,
    release: () => release.resolve(),
    stop: () => server.stop(true),
  };
}
export async function waitForMediaFact(fact: () => Promise<boolean>) {
  const deadline = performance.now() + 3000;
  while (!(await fact())) {
    if (performance.now() >= deadline)
      throw new Error('Media fact was not observed before its deadline');
    await Bun.sleep(10);
  }
}
