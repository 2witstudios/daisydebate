import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBrowserMediaTransport } from './browser-transport';
import { CHECKED_DEVICE_MISSING } from './media-controller';
import {
  events,
  publish,
  sources,
  stubSdk,
} from './browser-transport.test-support';
setupRitewayBun();

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

/** Applies a grant, returning the error name it failed with ('' if none). */
const failureOf = (work: Promise<unknown>) =>
  work.then(
    () => '',
    (error: unknown) => (error as Error).name,
  );

test('a missing checked camera fails at Round entry without fallback', async () => {
  const stub = stubSdk({ settles: true, missingSource: 'camera' });
  const missing: string[] = [];
  const { transport } = createBrowserMediaTransport(
    {
      ...events,
      devices: { camera: 'gone-device' },
      missing: (source) => void missing.push(source),
    },
    stub.sdk,
  );
  const failure = await failureOf(transport.apply(publish(['camera'])));
  assert({
    given: 'a checked camera missing before its first publication',
    should:
      'report that device missing without trying a default or browser detail',
    actual: {
      failure,
      missing,
      captures: stub.captures.length,
      published: sources(stub.published),
    },
    expected: {
      failure: CHECKED_DEVICE_MISSING,
      missing: ['camera'],
      captures: 1,
      published: [],
    },
  });
  transport.stopTracks();
});

test('a missing checked microphone is reported early but fails only the grant that needs it', async () => {
  const stub = stubSdk({ settles: true, missingSource: 'microphone' });
  const missing: string[] = [];
  const { transport } = createBrowserMediaTransport(
    {
      ...events,
      devices: { microphone: 'gone-device' },
      missing: (source) => void missing.push(source),
    },
    stub.sdk,
  );
  const cameraTurn = await failureOf(transport.apply(publish(['camera'])));
  const reported = [...missing];
  const speakingTurn = await failureOf(
    transport.apply(publish(['camera', 'microphone'])),
  );
  assert({
    given:
      'a checked microphone gone while the seat publishes only its camera, then a grant that needs the microphone',
    should:
      'keep the camera turn live while reporting the microphone, then fail the speaking grant without a default',
    actual: {
      cameraTurn,
      reported,
      speakingTurn,
      published: sources(stub.published),
    },
    expected: {
      cameraTurn: '',
      reported: ['microphone'],
      speakingTurn: CHECKED_DEVICE_MISSING,
      published: ['camera'],
    },
  });
  transport.stopTracks();
});

test('only a checked device is translated: unchecked absence and permission refusals pass through', async () => {
  const unchecked = stubSdk({ settles: true, missingSource: 'camera' });
  const missing: string[] = [];
  const plain = createBrowserMediaTransport(
    { ...events, missing: (source) => void missing.push(source) },
    unchecked.sdk,
  ).transport;
  const blocked = stubSdk({
    settles: true,
    missingSource: 'camera',
    missingError: 'NotAllowedError',
  });
  const denied = createBrowserMediaTransport(
    {
      ...events,
      devices: { camera: 'checked-camera' },
      missing: (source) => void missing.push(source),
    },
    blocked.sdk,
  ).transport;
  assert({
    given:
      'a default camera that is absent, and a checked camera the browser refuses',
    should:
      'surface each browser failure unchanged and report no missing checked device',
    actual: {
      unchecked: await failureOf(plain.apply(publish(['camera']))),
      denied: await failureOf(denied.apply(publish(['camera']))),
      missing,
    },
    expected: {
      unchecked: 'OverconstrainedError',
      denied: 'NotAllowedError',
      missing: [],
    },
  });
  plain.stopTracks();
  denied.stopTracks();
});
