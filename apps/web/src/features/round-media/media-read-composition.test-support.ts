import { createMediaRequest } from './request-media';
import { createMediaController } from './media-controller';
import { createBrowserMediaTransport } from './browser-transport';
import { stubSdk, events } from './browser-transport.test-support';
import { admission, snapshot } from './media-controller.test-support';
import { createTimerQueue } from '../realtime/connection-store.test-support';

const cameraOnly = {
  ...snapshot,
  grants: { ...snapshot.grants, publish: ['camera'] },
};

/**
 * The actual bounded adapter, controller and browser transport over a stub SDK.
 * The second reconcile stalls at `mode`. Controlled monotonic scheduling; these
 * numbers do not reconstruct a native trace.
 */
export async function compose(
  mode: 'headers' | 'body',
  retryDelaysMs: readonly number[] = [],
) {
  const timer = createTimerQueue((now, delay) => now + delay);
  const headers = Promise.withResolvers<Response>();
  const body = Promise.withResolvers<unknown>();
  const sdk = stubSdk({ settles: true });
  const browser = createBrowserMediaTransport(events, sdk.sdk);
  const applied: string[] = [];
  const received: string[] = [];
  const counts = {
    reads: 0,
    active: 0,
    maxActive: 0,
    stops: 0,
    connects: 0,
    admissions: 0,
  };
  let heldSignal: AbortSignal | undefined;
  let stallAll = false;
  const request = createMediaRequest({
    scheduleDeadline: (expire, ms) => {
      const id = timer.setTimeout(expire, ms);
      return () => timer.clearTimeout(id);
    },
    fetch: async (url, options) => {
      const signal = options?.signal;
      if (!signal) throw new Error('Missing media request signal');
      counts.active++;
      counts.maxActive = Math.max(counts.maxActive, counts.active);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        counts.active--;
        signal.removeEventListener('abort', finish);
      };
      signal.addEventListener('abort', finish, { once: true });
      const responseOf = (value: unknown) => {
        const response = Response.json(value);
        const json = response.json.bind(response);
        response.json = () => json().finally(finish);
        return response;
      };
      if (String(url).endsWith('/session')) {
        counts.admissions++;
        return responseOf(admission);
      }
      counts.reads++;
      if (counts.reads === 1) return responseOf(snapshot);
      if (counts.reads > 2 && !stallAll) return responseOf(cameraOnly);
      heldSignal = signal;
      if (mode === 'headers') return headers.promise;
      const response = Response.json({});
      response.json = () => body.promise.finally(finish);
      return response;
    },
  });
  const controller = createMediaController({
    roundId: snapshot.roundId,
    initialRoundViewVersion: 1,
    api: {
      admit: (id, signal) => request(id, 'session', signal),
      reconcile: (id, signal) => request(id, 'reconcile', signal),
    },
    transport: () => ({
      ...browser.transport,
      connect: async (value) => {
        counts.connects++;
        await browser.transport.connect(value);
      },
      apply: async (value) => {
        applied.push(value.grants.publish.join(','));
        await browser.transport.apply(value);
      },
      stopTracks: () => {
        counts.stops++;
        browser.transport.stopTracks();
      },
    }),
    changed: () => undefined,
    received: (value) => received.push(value.grants.publish.join(',')),
    retry: {
      delaysMs: retryDelaysMs,
      wait: (ms, signal) =>
        new Promise<void>((done) => {
          const id = timer.setTimeout(done, ms);
          signal.addEventListener(
            'abort',
            () => {
              timer.clearTimeout(id);
              done();
            },
            { once: true },
          );
        }),
    },
  });
  await controller.join();
  const camera = sdk.captured.find((track) => track.source === 'camera');
  applied.length = 0;
  received.length = 0;
  return {
    timer,
    controller,
    counts,
    applied,
    received,
    heldAborted: () => heldSignal?.aborted,
    stallEveryRead: () => {
      stallAll = true;
    },
    recoverReads: () => {
      stallAll = false;
    },
    release: () => {
      if (mode === 'headers') headers.resolve(Response.json(snapshot));
      else body.resolve(snapshot);
    },
    sameCamera: () =>
      sdk.captured.find((track) => track.source === 'camera') === camera &&
      camera?.ended === false,
    cameraEnded: () => camera?.ended,
  };
}
