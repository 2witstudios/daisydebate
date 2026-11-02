import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaRequest } from './request-media';
import { createMediaController } from './media-controller';
import { createBrowserMediaTransport } from './browser-transport';
import { stubSdk, events, settle } from './browser-transport.test-support';
import { admission, snapshot } from './media-controller.test-support';
import { createTimerQueue } from '../realtime/connection-store.test-support';
import { nextMediaRefreshAt } from './refresh-deadline';
import { ran } from '../../ui/debate-room/live-round.test-support';
setupRitewayBun();

/** Controlled monotonic scheduling; these numbers do not reconstruct a native trace. */
async function exercise(mode: 'headers' | 'body', dispose: boolean) {
  const timer = createTimerQueue((now, delay) => now + delay);
  const view = ran(1);
  const deadlineMs = nextMediaRefreshAt(view)!;
  const startMs = deadlineMs - 60000;
  const clock = { now: () => new Date(startMs + timer.now()).toISOString() };
  const held = Promise.withResolvers<Response>();
  const body = Promise.withResolvers<unknown>();
  const sdk = stubSdk({ settles: true });
  const browser = createBrowserMediaTransport(events, sdk.sdk);
  const applied: string[] = [],
    received: string[] = [];
  let reads = 0,
    active = 0,
    maxActive = 0,
    stops = 0,
    connects = 0,
    admissions = 0;
  let oldSignal: AbortSignal | undefined;
  let fresh = false;
  const request = createMediaRequest({
    scheduleDeadline: (expire) => {
      const id = timer.setTimeout(expire, 10000);
      return () => timer.clearTimeout(id);
    },
    fetch: async (url, options) => {
      const signal = options?.signal;
      if (!signal) throw new Error('Missing media request signal');
      active++;
      maxActive = Math.max(maxActive, active);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        active--;
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
        admissions++;
        return responseOf(admission);
      }
      if (++reads !== 2)
        return responseOf(
          fresh
            ? {
                ...snapshot,
                grants: { ...snapshot.grants, publish: ['camera'] },
              }
            : snapshot,
        );
      oldSignal = signal;
      if (mode === 'headers') return held.promise;
      const response = Response.json({});
      response.json = () => body.promise.finally(finish);
      return response;
    },
  });
  const controller = createMediaController({
    roundId: snapshot.roundId,
    initialRoundViewVersion: view.version,
    api: {
      admit: (id, signal) => request(id, 'session', signal),
      reconcile: (id, signal) => request(id, 'reconcile', signal),
    },
    transport: () => ({
      ...browser.transport,
      connect: async (value) => {
        connects++;
        await browser.transport.connect(value);
      },
      apply: async (value) => {
        applied.push(value.grants.publish.join(','));
        await browser.transport.apply(value);
      },
      stopTracks: () => {
        stops++;
        browser.transport.stopTracks();
      },
    }),
    changed: () => undefined,
    received: (value) => received.push(value.grants.publish.join(',')),
  });
  await controller.join();
  const camera = sdk.captured.find((track) => track.source === 'camera');
  applied.length = 0;
  received.length = 0;
  const boundary = timer.setTimeout(
    () => {
      fresh = true;
      void controller.reconcile({
        kind: 'boundary',
        roundViewVersion: view.version,
        deadlineMs,
      });
    },
    Math.max(0, deadlineMs - Date.parse(clock.now())),
  );
  timer.advance(59000);
  const pending = controller.reconcile({ kind: 'wake' });
  await settle();
  if (dispose) {
    timer.clearTimeout(boundary);
    controller.stop();
  } else {
    timer.advance(1000);
    await settle();
    timer.advance(200);
    void controller.reconcile({
      kind: 'view',
      roundViewVersion: view.version + 1,
    });
    await settle();
  }
  const current = [
    oldSignal?.aborted,
    active,
    maxActive,
    admissions,
    connects,
    stops,
    controller.state(),
    camera?.ended,
  ];
  if (mode === 'headers') held.resolve(Response.json(snapshot));
  else body.resolve(snapshot);
  await pending;
  await settle();
  const after = [
    applied.some((sources) => sources.includes('microphone')),
    received.some((sources) => sources.includes('microphone')),
    sdk.captured.find((track) => track.source === 'camera') === camera,
  ];
  controller.stop();
  timer.advance(120000);
  await settle();
  return { current, after, timers: timer.pending(), active };
}
for (const mode of ['headers', 'body'] as const) {
  test(`within-budget ${mode} supersession preserves actual SDK camera and rejects old authority`, async () => {
    const result = await exercise(mode, false);
    assert({
      given:
        'actual bounded HTTP adapter, controller, SDK and a due deadline followed by a newer accepted view',
      should:
        'abort obsolete work, retain the same healthy camera/transport and apply/announce only fresh server authority',
      actual: result,
      expected: {
        current: [true, 0, 1, 1, 1, 0, 'live', false],
        after: [false, false, true],
        timers: 0,
        active: 0,
      },
    });
  });
  test(`disposal cancels actual ${mode} and browser SDK ownership`, async () => {
    const result = await exercise(mode, true);
    assert({
      given: 'terminal/account mount disposal with actual bounded HTTP and SDK',
      should:
        'settle without deadline or queued work and never apply late media',
      actual: result,
      expected: {
        current: [true, 0, 1, 1, 1, 1, 'ended', true],
        after: [false, false, true],
        timers: 0,
        active: 0,
      },
    });
  });
}
