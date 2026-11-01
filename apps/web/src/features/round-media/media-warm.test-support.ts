import { MemoryStorage } from '../../lib/storage.test-support';
import { rememberPassedMediaChecks } from './media-device-check.test-support';
import {
  readCheckedDevices,
  forgetCheckedDevices,
} from '../video/device-selection';
import {
  createBrowserMediaTransport,
  type MediaTrack,
  type Source,
} from './browser-transport';
import { createMediaController } from './media-controller';
import { retryMissingDevices, type SourceIllHealth } from './media-status';
import { admission, snapshot, roundId } from './media-controller.test-support';
import { events, stubSdk } from './browser-transport.test-support';
export const enterCameraTurn = async (failFirstWarm: boolean) => {
  const storage = new MemoryStorage();
  const host = () => storage;
  await rememberPassedMediaChecks(host, 'room-a', 'actor-a');
  const stub = stubSdk({ settles: true });
  const remote = stub.subscribePeer('microphone');
  const microphones: unknown[] = [];
  let missing: readonly Source[] = [];
  let failures: readonly SourceIllHealth[] = [];
  let tracks: readonly MediaTrack[] = [];
  let publish: readonly Source[] = ['camera'];
  let admissions = 0;
  const browser = createBrowserMediaTransport(
    {
      ...events,
      checkedDevices: () => readCheckedDevices('room-a', host, 'actor-a'),
      missing: (source) => {
        missing = [...missing, source];
      },
      sourceHealthy: (source) => {
        missing = missing.filter((held) => held !== source);
        failures = failures.filter(([held]) => held !== source);
      },
      sourceFailed: (source, failure) => {
        failures = [...failures, [source, failure.kind]];
      },
      tracks: (value) => {
        tracks = value;
      },
    },
    {
      ...stub.sdk,
      capture: async (input) => {
        if (input?.audio) {
          microphones.push(input.audio);
          if (failFirstWarm && microphones.length === 1)
            throw { name: 'NotFoundError' };
        }
        return stub.sdk.capture(input);
      },
    },
  );
  const current = () => ({
    ...snapshot,
    grants: { ...snapshot.grants, publish },
  });
  const controller = createMediaController({
    roundId,
    recovery: { schedule: () => null, cancel: () => undefined },
    api: {
      admit: async () => {
        admissions++;
        return { ...admission, grants: current().grants };
      },
      reconcile: async () => current(),
    },
    transport: () => browser.transport,
    changed: () => undefined,
  });
  await controller.join();
  return {
    controller,
    browser,
    stub,
    microphones,
    host,
    remote,
    missing: () => missing,
    failures: () => failures,
    tracks: () => tracks,
    admissions: () => admissions,
    grantMicrophone: () => {
      publish = ['camera', 'microphone'];
    },
    revokeMicrophone: () => {
      publish = ['camera'];
    },
    retryMissing: () => {
      missing = retryMissingDevices(
        'room-a',
        missing,
        'actor-a',
        (room, kinds, _storage, actor) =>
          forgetCheckedDevices(room, kinds, host, actor),
      );
      return controller.retry();
    },
  };
};
