import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBrowserMediaTransport, type Source } from './browser-transport';
import { createMediaController } from './media-controller';
import type { RoundMediaAdmission, RoundMediaState } from '@daisy/protocol';
import {
  events,
  publish,
  sources,
  stubSdk,
} from './browser-transport.test-support';
setupRitewayBun();

/** Returns the error name an apply failed with, or '' when it resolved. */
const failureOf = (work: Promise<unknown>) =>
  work.then(
    () => '',
    (error: unknown) => error.name,
  );

test('Round capture pins the same camera and warm microphone that passed the Room check', async () => {
  const stub = stubSdk({ settles: true });
  const { transport } = createBrowserMediaTransport(
    {
      ...events,
      devices: { camera: 'checked-camera', microphone: 'checked-mic' },
    },
    stub.sdk,
  );
  await transport.apply(publish(['camera']));
  await transport.apply(publish(['camera', 'microphone']));
  assert({
    given:
      'non-default checked devices and a microphone warmed before its grant',
    should: 'capture each exact device once and publish those tracks',
    actual: {
      choices: stub.captures.map((capture) => {
        const options = capture as { audio: unknown; video: unknown };
        return options.audio
          ? options.audio
          : (options.video as { deviceId: unknown }).deviceId;
      }),
      published: sources(stub.published),
    },
    expected: {
      choices: [
        { exact: 'checked-camera' },
        { deviceId: { exact: 'checked-mic' } },
      ],
      published: ['camera', 'microphone'],
    },
  });
  transport.stopTracks();
});

test('a missing checked camera at Round entry is reported explicitly and never falls back to a default', async () => {
  const stub = stubSdk({ settles: true, missingSource: 'camera' });
  const missing: string[] = [];
  const reported: [Source, string][] = [];
  const { transport } = createBrowserMediaTransport(
    {
      ...events,
      devices: { camera: 'gone-device' },
      missing: (source) => void missing.push(source),
      sourceFailed: (source, error) => void reported.push([source, error.name]),
    },
    stub.sdk,
  );
  const failure = await failureOf(transport.apply(publish(['camera'])));
  assert({
    given: 'a checked camera missing before its first publication',
    should:
      'name only the checked device gone, with no retry against a default and no second failure mode',
    actual: {
      failure,
      missing,
      reported,
      cameraCaptures: stub.captures.filter(
        (capture) => !(capture as { audio: boolean }).audio,
      ).length,
      published: sources(stub.published),
    },
    expected: {
      failure: '',
      missing: ['camera'],
      reported: [],
      cameraCaptures: 1,
      published: [],
    },
  });
  transport.stopTracks();
});

test('a missing checked microphone keeps the camera turn live and is reported explicitly', async () => {
  const stub = stubSdk({ settles: true, missingSource: 'microphone' });
  const missing: string[] = [];
  const reported: [Source, string][] = [];
  const { transport } = createBrowserMediaTransport(
    {
      ...events,
      devices: { microphone: 'gone-device' },
      missing: (source) => void missing.push(source),
      sourceFailed: (source, error) => void reported.push([source, error.name]),
    },
    stub.sdk,
  );
  const cameraTurn = await failureOf(transport.apply(publish(['camera'])));
  const reportedEarly = [...missing];
  const speakingTurn = await failureOf(
    transport.apply(publish(['camera', 'microphone'])),
  );
  const camera = stub.captured.find((track) => track.source === 'camera')!;
  assert({
    given:
      'a checked microphone gone while the seat publishes only its camera, then a grant that needs the microphone',
    should:
      'keep the camera turn live, report the checked microphone once, and never capture a default to replace it',
    actual: {
      cameraTurn,
      reportedEarly,
      speakingTurn,
      reported,
      capturedMicrophones: stub.captured.filter(
        (track) => track.source === 'microphone',
      ).length,
      cameraLive: !camera.ended,
      published: sources(stub.published),
    },
    expected: {
      cameraTurn: '',
      reportedEarly: ['microphone'],
      speakingTurn: '',
      reported: [],
      capturedMicrophones: 0,
      cameraLive: true,
      published: ['camera'],
    },
  });
  transport.stopTracks();
});

test('only a checked device the Room check passed is named missing; other failures surface typed', async () => {
  const absent = stubSdk({ settles: true, missingSource: 'camera' });
  const missing: string[] = [];
  const reported: [Source, string][] = [];
  const plain = createBrowserMediaTransport(
    {
      ...events,
      missing: (source) => void missing.push(source),
      sourceFailed: (source, error) => void reported.push([source, error.name]),
    },
    absent.sdk,
  ).transport;
  const refused = stubSdk({
    settles: true,
    missingSource: 'camera',
    missingError: 'NotAllowedError',
  });
  const denied = createBrowserMediaTransport(
    {
      ...events,
      devices: { camera: 'checked-camera' },
      missing: (source) => void missing.push(source),
      sourceFailed: (source, error) => void reported.push([source, error.name]),
    },
    refused.sdk,
  ).transport;
  const uncheckedFailure = await failureOf(plain.apply(publish(['camera'])));
  const deniedFailure = await failureOf(denied.apply(publish(['camera'])));
  assert({
    given:
      'a default camera that is absent, and a checked camera the browser refuses, each the pass’s only source',
    should:
      'reject each all-blocked pass with its browser error, name each through the typed report, and report no missing checked device',
    actual: {
      uncheckedFailure,
      deniedFailure,
      typed: reported,
      missing,
    },
    expected: {
      uncheckedFailure: 'OverconstrainedError',
      deniedFailure: 'NotAllowedError',
      typed: [
        ['camera', 'OverconstrainedError'],
        ['camera', 'NotAllowedError'],
      ],
      missing: [],
    },
  });
  plain.stopTracks();
  denied.stopTracks();
});

test('a camera failure no longer stops the microphone: the pass isolates per source and reports truthfully', async () => {
  const broken = stubSdk({
    settles: true,
    missingSource: 'camera',
    missingError: 'NotReadableError',
  });
  const typed: [Source, string][] = [];
  const { transport } = createBrowserMediaTransport(
    {
      ...events,
      devices: { camera: 'empty-slots' },
      sourceFailed: (source, error) => void typed.push([source, error.name]),
    },
    broken.sdk,
  );
  const failure = await failureOf(
    transport.apply(publish(['camera', 'microphone'])),
  );
  const microphone = stubMicrophoneOf(broken);
  assert({
    given: 'a checked camera the reader cannot read, and a microphone grant',
    should:
      'resolve the same pass, publish the microphone and leave it live while naming only the camera loss',
    actual: {
      failure,
      typed,
      published: sources(broken.published),
      microphoneLive: !microphone.ended,
    },
    expected: {
      failure: '',
      typed: [['camera', 'NotReadableError']],
      published: ['microphone'],
      microphoneLive: true,
    },
  });
  transport.stopTracks();
});

const stubMicrophoneOf = (stub: ReturnType<typeof stubSdk>) =>
  stub.captured.find((track) => track.source === 'microphone')!;

/** The composed admission the real controller asks the endpoint for. */
const liveAdmission = (roundId: string): RoundMediaAdmission => ({
  version: 1,
  roundId,
  state: 'ready',
  grants: {
    publish: ['camera', 'microphone'],
    subscribe: true,
    hidden: false,
    capture: false,
  },
  peers: [],
  identity: 'p'.repeat(24),
  token: 'private-token',
  url: 'wss://media.invalid',
  expiresAt: '2026-10-22T09:01:00.000Z',
});

const liveSnapshot = (roundId: string): RoundMediaState => ({
  version: 1,
  roundId,
  state: 'ready',
  grants: {
    publish: ['camera', 'microphone'],
    subscribe: true,
    hidden: false,
    capture: false,
  },
  peers: [],
});

/**
 * The composed lifetime: the real controller driving the real transport,
 * so a per-source failure proves isolation there too and not only inside
 * one settle pass (ISSUE-817/829).
 */
test('the real controller keeps the working microphone and its subscriptions live through a camera failure', async () => {
  const roundId = 'r'.repeat(24);
  const broken = stubSdk({
    settles: true,
    missingSource: 'camera',
    missingError: 'NotReadableError',
  });
  const typed: [Source, string][] = [];
  const healthy: Source[] = [];
  let connection = 'connecting';
  let announced = 0;
  const browser = createBrowserMediaTransport(
    {
      ...events,
      devices: { camera: 'empty-slots' },
      sourceFailed: (source, error) => void typed.push([source, error.name]),
      sourceHealthy: (source) => void healthy.push(source),
    },
    broken.sdk,
  );
  const controller = createMediaController({
    roundId,
    api: {
      admit: async () => liveAdmission(roundId),
      reconcile: async () => liveSnapshot(roundId),
    },
    transport: () => browser.transport,
    changed: (state) => {
      connection = state;
    },
    received: () => {
      announced++;
    },
  });
  await controller.join();
  const published = sources(broken.published);
  const microphoneTrack = stubMicrophoneOf(broken);
  assert({
    given:
      'the composed controller and transport with a camera that cannot read and a microphone grant',
    should:
      'reach live, publish the microphone and keep its track alive while only the camera reports a per source loss',
    actual: {
      connection,
      published,
      microphoneTrackLive: Boolean(microphoneTrack && !microphoneTrack.ended),
      reported: typed,
      recovered: healthy,
      announcements: announced,
    },
    expected: {
      connection: 'live',
      published: ['microphone'],
      microphoneTrackLive: true,
      reported: [['camera', 'NotReadableError']],
      recovered: ['microphone'],
      announcements: 1,
    },
  });
  controller.stop();
});

test('a checked camera gone keeps the microphone live at Round entry through the real controller', async () => {
  const roundId = 'r'.repeat(24);
  const gone = stubSdk({ settles: true, missingSource: 'camera' });
  const missing: Source[] = [];
  const typed: [Source, string][] = [];
  let connection = 'connecting';
  const browser = createBrowserMediaTransport(
    {
      ...events,
      devices: { camera: 'gone-device' },
      missing: (source) => void missing.push(source),
      sourceFailed: (source, error) => void typed.push([source, error.name]),
    },
    gone.sdk,
  );
  const controller = createMediaController({
    roundId,
    api: {
      admit: async () => liveAdmission(roundId),
      reconcile: async () => liveSnapshot(roundId),
    },
    transport: () => browser.transport,
    changed: (state) => {
      connection = state;
    },
  });
  await controller.join();
  assert({
    given:
      'the camera the Round check passed that is now gone, and a working microphone grant',
    should:
      'report that checked device alone and reach live with the microphone published and its track left open',
    actual: {
      connection,
      missing,
      typed,
      published: sources(gone.published),
      microphoneLive: !stubMicrophoneOf(gone).ended,
      cameraCaptures: gone.captures.filter(
        (capture) => !(capture as { audio: boolean; video: boolean }).audio,
      ).length,
    },
    expected: {
      connection: 'live',
      missing: ['camera'],
      typed: [],
      published: ['microphone'],
      microphoneLive: true,
      cameraCaptures: 1,
    },
  });
  controller.stop();
});

test('warm capture failure is reported and a later grant recovers with a fresh capture', async () => {
  const stub = stubSdk({ settles: true });
  let failedWarm = false;
  const capture = stub.sdk.capture.bind(stub.sdk);
  const failingFirst = ((options: {
    audio?: boolean | undefined;
    video?: unknown;
  }) =>
    options.audio && !failedWarm
      ? ((failedWarm = true),
        Promise.reject(new DOMException('private', 'NotReadableError')))
      : capture(options as never)) as unknown as typeof stub.sdk.capture;
  const failingSdk = { ...stub.sdk, capture: failingFirst };
  const typed: [Source, string][] = [];
  const recovered: Source[] = [];
  const { transport } = createBrowserMediaTransport(
    {
      ...events,
      sourceFailed: (source, error) => void typed.push([source, error.name]),
      sourceHealthy: (source) => void recovered.push(source),
    },
    failingSdk,
  );
  const cameraOnly = await failureOf(transport.apply(publish(['camera'])));
  await transport.apply(publish(['camera', 'microphone']));
  assert({
    given:
      'a microphone whose warm capture fails once, then a speaking grant that needs the microphone',
    should:
      'report the warm failure twice-when it recurs, publish the microphone at its grant, and report recovery',
    actual: {
      cameraOnly,
      typed,
      published: sources(stub.published),
      recovered,
      live: !stubMicrophoneOf(stub).ended,
    },
    expected: {
      cameraOnly: '',
      typed: [['microphone', 'NotReadableError']],
      published: ['camera', 'microphone'],
      recovered: ['camera', 'microphone'],
      live: true,
    },
  });
  transport.stopTracks();
});

/**
 * The CI-shaped regression: a browser that refuses every granted device
 * (headless Chromium without permissions). A pass with nothing publishable
 * must fail honestly instead of holding an empty transport — while the same
 * pass with one working source keeps it (ISSUE-817/829 alongside the
 * attendance suite's one-open-socket invariant).
 */
test('an all-blocked pass fails; one working source keeps the session live', async () => {
  const roundId = 'r'.repeat(24);
  const both = stubSdk({ settles: true });
  const refusingEverything = {
    room: both.sdk.room,
    capture: (() =>
      Promise.reject(
        new DOMException('private', 'NotAllowedError'),
      )) as unknown as typeof both.sdk.capture,
  };
  const microphoneWorks = stubSdk({
    settles: true,
    missingSource: 'camera',
    missingError: 'NotAllowedError',
  });
  let stoppedAllBlocked = 0;
  const allBlocked = createBrowserMediaTransport(
    {
      ...events,
      sourceFailed: () => undefined,
    },
    refusingEverything,
  ).transport;
  const controllerAllBlocked = createMediaController({
    roundId,
    api: {
      admit: async () => liveAdmission(roundId),
      reconcile: async () => liveSnapshot(roundId),
    },
    transport: () => ({
      connect: allBlocked.connect,
      apply: async (state) => {
        try {
          await allBlocked.apply(state);
        } finally {
          void 0;
        }
      },
      stopTracks: () => {
        stoppedAllBlocked++;
      },
      disconnect: allBlocked.disconnect,
    }),
    changed: () => undefined,
  });
  await controllerAllBlocked.join();
  const partialController = createMediaController({
    roundId,
    api: {
      admit: async () => liveAdmission(roundId),
      reconcile: async () => liveSnapshot(roundId),
    },
    transport: () =>
      createBrowserMediaTransport(
        {
          ...events,
          devices: { microphone: 'checked-microphone' },
        },
        // The camera alone is refused; the checked microphone still captures.
        (() => {
          let refusedCamera = false;
          const capture = microphoneWorks.sdk.capture.bind(microphoneWorks.sdk);
          const sdk = {
            room: microphoneWorks.sdk.room,
            capture: ((options: {
              audio?: boolean | undefined;
              video?: unknown;
            }) =>
              !options.audio && !refusedCamera
                ? ((refusedCamera = true),
                  Promise.reject(
                    new DOMException('private', 'NotAllowedError'),
                  ))
                : capture(
                    options as never,
                  )) as unknown as typeof microphoneWorks.sdk.capture,
          };
          return sdk as unknown as typeof microphoneWorks.sdk;
        })(),
      ).transport,
    changed: () => undefined,
  });
  await partialController.join();
  assert({
    given:
      'both granted sources refused by the browser, then the same refusal with a working checked microphone',
    should:
      'tear the empty session down to device-blocked, and keep the partial one live with the microphone published',
    actual: {
      allBlockedState: controllerAllBlocked.state(),
      allBlockedStoppedTracks: stoppedAllBlocked > 0,
      partialState: partialController.state(),
      partialPublished: sources(microphoneWorks.published),
    },
    expected: {
      allBlockedState: 'device-blocked',
      allBlockedStoppedTracks: true,
      partialState: 'live',
      partialPublished: ['microphone'],
    },
  });
  controllerAllBlocked.stop();
  partialController.stop();
});
