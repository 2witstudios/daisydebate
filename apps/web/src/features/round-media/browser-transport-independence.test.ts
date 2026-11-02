import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoomEvent } from 'livekit-client';
import { createBrowserMediaTransport } from './browser-transport';
import {
  events,
  publish,
  settle,
  sources,
  stubSdk,
} from './browser-transport.test-support';
setupRitewayBun();

const reported = () => {
  const log: string[] = [];
  return {
    log,
    events: {
      ...events,
      missing: (source: string) => log.push(`missing ${source}`),
      sourceFailed: (source: string, failure: { kind: string }) =>
        log.push(`failed ${source} ${failure.kind}`),
      sourceHealthy: (source: string) => log.push(`healthy ${source}`),
      sourceWaiting: (source: string) => log.push(`waiting ${source}`),
    },
  };
};

test('a camera prompt nobody answers cannot hold the microphone or the connection', async () => {
  const gate = Promise.withResolvers<void>();
  const stub = stubSdk({ settles: true, captureGates: [gate.promise] });
  const { log, events: observed } = reported();
  let expire = () => {};
  const { transport } = createBrowserMediaTransport(
    {
      ...observed,
      capturePatience: (expired) => {
        expire = expired;
        return () => undefined;
      },
    },
    stub.sdk,
  );
  let applied = false;
  void transport.apply(publish(['camera', 'microphone'])).then(() => {
    applied = true;
  });
  await settle();
  const beforePatience = { published: sources(stub.published), applied };
  expire();
  await settle();
  assert({
    given: 'a camera capture that never answers',
    should: 'publish the microphone at once',
    actual: beforePatience,
    expected: { published: ['microphone'], applied: false },
  });
  assert({
    given: 'patience expiring while the prompt is still open',
    should: 'let the connection go live and name only the waiting camera',
    actual: { applied, log },
    expected: { applied: true, log: ['healthy microphone', 'waiting camera'] },
  });
  gate.resolve();
  await settle();
  assert({
    given: 'the prompt answered later',
    should: 'publish the camera and clear its waiting state',
    actual: { published: sources(stub.published), last: log.at(-1) },
    expected: { published: ['microphone', 'camera'], last: 'healthy camera' },
  });
});

test('a grant lost during an open prompt is never published when the prompt answers', async () => {
  const gate = Promise.withResolvers<void>();
  const stub = stubSdk({ settles: true, captureGates: [gate.promise] });
  const { transport } = createBrowserMediaTransport(events, stub.sdk);
  void transport.apply(publish(['camera']));
  await settle();
  void transport.apply(publish([]));
  await settle();
  gate.resolve();
  await settle();
  assert({
    given: 'a camera grant withdrawn while its capture was pending',
    should: 'release the late track instead of publishing outside the grant',
    actual: {
      published: sources(stub.published),
      held: stub.captured.filter((track) => !track.ended).length,
      camera: stub.captured.filter((track) => track.source === 'camera').length,
    },
    expected: { published: [], held: 0, camera: 1 },
  });
});

test('a failed source waits for an explicit retry instead of prompting on every read', async () => {
  const stub = stubSdk({
    settles: true,
    missingSource: 'camera',
    missingError: 'NotAllowedError',
  });
  const { log, events: observed } = reported();
  const { transport } = createBrowserMediaTransport(observed, stub.sdk);
  await transport.apply(publish(['camera', 'microphone']));
  const first = stub.captures.length;
  await transport.apply(publish(['camera', 'microphone']));
  await transport.apply(publish(['camera', 'microphone']));
  const afterReads = stub.captures.length;
  transport.allowRecapture();
  await transport.apply(publish(['camera', 'microphone']));
  assert({
    given: 'a refused camera and repeated reads, then an explicit retry',
    should: 'capture again only after the retry',
    actual: {
      repeated: afterReads - first,
      retried: stub.captures.length - afterReads,
      failures: log.filter((line) => line.startsWith('failed')).length,
    },
    expected: { repeated: 0, retried: 1, failures: 2 },
  });
});

test('a failed source no longer wanted clears, and gets one attempt if wanted again', async () => {
  const stub = stubSdk({
    settles: true,
    missingSource: 'camera',
    missingError: 'NotReadableError',
  });
  const { log, events: observed } = reported();
  const { transport } = createBrowserMediaTransport(observed, stub.sdk);
  await transport.apply(publish(['camera']));
  await transport.apply(publish([]));
  const cleared = log.at(-1);
  const cameraAsks = () =>
    stub.captures.filter((capture) => (capture as { video: unknown }).video)
      .length;
  const before = cameraAsks();
  await transport.apply(publish(['camera']));
  assert({
    given: 'a failed camera whose grant ends, then returns',
    should: 'clear the stale claim and try once on the new grant',
    actual: { cleared, attempts: cameraAsks() - before },
    expected: { cleared: 'healthy camera', attempts: 1 },
  });
});

test('a warm microphone that captures later clears its earlier failure', async () => {
  const stub = stubSdk({ settles: true });
  const { log, events: observed } = reported();
  const { transport } = createBrowserMediaTransport(observed, stub.sdk);
  await transport.apply(publish(['camera']));
  assert({
    given: 'a warm microphone captured for a camera-only turn',
    should: 'report it healthy, since nothing about it is failing',
    actual: log.includes('healthy microphone'),
    expected: true,
  });
});

test('a device that dies after publish and cannot restart is reported and can be retried', async () => {
  const stub = stubSdk({ settles: true });
  const { log, events: observed } = reported();
  const { transport } = createBrowserMediaTransport(observed, stub.sdk);
  await transport.apply(publish(['microphone']));
  const [track] = stub.captured;
  track!.mediaStreamTrack.readyState = 'ended';
  stub.fire(RoomEvent.TrackMuted);
  await settle();
  const afterDeath = { published: sources(stub.published), last: log.at(-1) };
  const count = stub.captures.length;
  await transport.apply(publish(['microphone']));
  const noPrompt = stub.captures.length - count;
  transport.allowRecapture();
  await transport.apply(publish(['microphone']));
  assert({
    given: 'a published microphone the SDK could only mute after it ended',
    should: 'drop it, name its absence and recapture only on retry',
    actual: { ...afterDeath, noPrompt, finally: sources(stub.published) },
    expected: {
      published: [],
      last: 'failed microphone absence',
      noPrompt: 0,
      finally: ['microphone'],
    },
  });
});

test('an SDK restart onto another device is reported, never a silent swap', async () => {
  const stub = stubSdk({ settles: true });
  const { log, events: observed } = reported();
  const { transport } = createBrowserMediaTransport(
    {
      ...observed,
      checkedDevices: () => ({
        state: 'available',
        choices: { microphone: 'checked-mic' },
      }),
    },
    stub.sdk,
  );
  await transport.apply(publish(['microphone']));
  const [track] = stub.captured;
  track!.mediaStreamTrack.deviceId = 'default';
  track!.emit('restarted');
  assert({
    given: 'a checked microphone the SDK restarted on the default device',
    should: 'report the checked device missing while the audio keeps flowing',
    actual: { last: log.at(-1), published: sources(stub.published) },
    expected: { last: 'missing microphone', published: ['microphone'] },
  });
});
