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

for (const source of ['camera', 'microphone'] as const) {
  test(`a missing selected ${source} fails at Round entry without fallback`, async () => {
    const stub = stubSdk({ settles: true, missingSource: source });
    const { transport } = createBrowserMediaTransport(
      { ...events, devices: { [source]: 'gone-device' } },
      stub.sdk,
    );
    let failure = '';
    try {
      await transport.apply(publish(['camera']));
    } catch (error) {
      failure = (error as Error).name;
    }
    assert({
      given: `a selected ${source} missing before its first publication`,
      should:
        'surface the exact-device failure at Round entry without trying a default',
      actual: {
        failure,
        captures: stub.captures.length,
        published: sources(stub.published),
      },
      expected: {
        failure: CHECKED_DEVICE_MISSING,
        captures: source === 'camera' ? 1 : 2,
        published: source === 'camera' ? [] : ['camera'],
      },
    });
    transport.stopTracks();
  });
}
