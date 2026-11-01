import { assert, setupRitewayBun, test } from 'riteway/bun';
import { enterCameraTurn } from './media-warm.test-support';
import { sources } from './browser-transport.test-support';
setupRitewayBun();

test('forgotten microphone choice cannot promote an obsolete recovered warm track', async () => {
  const flow = await enterCameraTurn(true);
  await flow.controller.reconcile();
  const recoveredWarm = flow.stub.captured.find(
    (track) => track.source === 'microphone',
  )!;
  const camera = flow.stub.published.find(
    (track) => track.source === 'camera',
  )!;
  const beforeRetry = flow.missing();
  await flow.retryMissing();
  flow.grantMicrophone();
  await flow.controller.reconcile();
  assert({
    given:
      'a checked microphone absent at first warm-up, recovered warm but still reported missing, then explicitly forgotten before its grant',
    should:
      'capture the requested default rather than publish the old warm choice, retaining camera, reception and one admission',
    actual: {
      beforeRetry,
      microphones: flow.microphones,
      oldWarmEnded: recoveredWarm.ended,
      cameraRetained: flow.stub.published.includes(camera) && !camera.ended,
      remoteRetained: flow
        .tracks()
        .some((track) => Object.is(track.track, flow.remote)),
      local: sources(flow.stub.published),
      admissions: flow.admissions(),
    },
    expected: {
      beforeRetry: ['microphone'],
      microphones: [
        { deviceId: { exact: 'microphone-checked' } },
        { deviceId: { exact: 'microphone-checked' } },
        true,
      ],
      oldWarmEnded: true,
      cameraRetained: true,
      remoteRetained: true,
      local: ['camera', 'microphone'],
      admissions: 1,
    },
  });
  flow.controller.stop();
});

test('an unchanged healthy warm microphone keeps its exact native track when granted', async () => {
  const flow = await enterCameraTurn(false);
  const warm = flow.stub.captured.find(
    (track) => track.source === 'microphone',
  )!;
  flow.grantMicrophone();
  await flow.controller.reconcile();
  assert({
    given: 'healthy checked warm input whose scoped choice has not changed',
    should: 'reuse that track without another capture or admission',
    actual: {
      microphones: flow.microphones,
      reused: flow.stub.published.includes(warm),
      ended: warm.ended,
      admissions: flow.admissions(),
    },
    expected: {
      microphones: [{ deviceId: { exact: 'microphone-checked' } }],
      reused: true,
      ended: false,
      admissions: 1,
    },
  });
  flow.controller.stop();
});

test('an unreadable current preference cannot promote a warm microphone', async () => {
  const flow = await enterCameraTurn(false);
  const warm = flow.stub.captured.find(
    (track) => track.source === 'microphone',
  )!;
  const storage = flow.host();
  const read = storage.getItem.bind(storage);
  storage.getItem = () => {
    throw new Error('private storage fault');
  };
  flow.grantMicrophone();
  await flow.controller.reconcile();
  const blocked = {
    local: sources(flow.stub.published),
    failures: flow.failures(),
    warmEnded: warm.ended,
    microphones: flow.microphones.length,
  };
  storage.getItem = read;
  await flow.controller.retry();
  assert({
    given:
      'a warm checked microphone whose current scoped choice cannot be read before its grant, then a readable unchanged choice',
    should:
      'hold publication with an honest preference failure and reuse the same healthy warm input once verified',
    actual: {
      blocked,
      reused: flow.stub.published.includes(warm),
      microphones: flow.microphones.length,
      connection: flow.controller.state(),
    },
    expected: {
      blocked: {
        local: ['camera'],
        failures: [['microphone', 'preference-unreadable']],
        warmEnded: false,
        microphones: 1,
      },
      reused: true,
      microphones: 1,
      connection: 'live',
    },
  });
  flow.controller.stop();
});

test('a stale mute rejection cannot remove or report failure on a replacement microphone', async () => {
  const flow = await enterCameraTurn(true);
  await flow.controller.reconcile();
  const oldWarm = flow.stub.captured.find(
    (track) => track.source === 'microphone',
  )!;
  const gate = Promise.withResolvers<void>();
  oldWarm.mute = async () => {
    await gate.promise;
    throw new Error('old private mute failure');
  };
  const pending = flow.browser.setMicrophoneMuted(true);
  await flow.retryMissing();
  flow.grantMicrophone();
  await flow.controller.reconcile();
  const replacement = flow.stub.captured
    .filter((track) => track.source === 'microphone')
    .at(-1)!;
  gate.reject(new Error('old private mute failure'));
  let rejected = false;
  await pending.catch(() => {
    rejected = true;
  });
  const active = {
    rejected,
    replaced: replacement !== oldWarm,
    failures: flow.failures(),
    newLive: !replacement.ended,
  };
  flow.controller.stop();
  assert({
    given:
      'an old warm-source mute rejecting after explicit default Retry and a fresh source grant',
    should:
      'leave the replacement owned and healthy, report no stale failure and release it on final stop',
    actual: { active, replacementEnded: replacement.ended },
    expected: {
      active: { rejected: true, replaced: true, failures: [], newLive: true },
      replacementEnded: true,
    },
  });
});
