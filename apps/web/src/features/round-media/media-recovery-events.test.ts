import { assert, setupRitewayBun, test } from 'riteway/bun';
import { subscribeMediaRecovery } from './media-recovery-events';
import { createMediaController, mediaFailure } from './media-controller';
import {
  admission,
  snapshot,
  transportStub,
} from './media-controller.test-support';

setupRitewayBun();

const recovery = {
  delaysMs: [],
  schedule: () => null,
  cancel: () => undefined,
};

test('real online/visibility events coalesce at the controller and cannot restart definite or ended state', async () => {
  const online = new EventTarget(),
    visibility = new EventTarget();
  let visible = true,
    requests = 0;
  const controller = createMediaController({
    roundId: admission.roundId,
    api: {
      admit: async () => {
        requests++;
        throw mediaFailure(400);
      },
      reconcile: async () => snapshot,
    },
    transport: transportStub,
    changed: () => undefined,
    recovery,
  });
  let work: Promise<void> = Promise.resolve();
  const dispose = subscribeMediaRecovery({
    online,
    visibility,
    isVisible: () => visible,
    nudge: () => {
      work = controller.nudge();
    },
  });
  await controller.join();
  online.dispatchEvent(new Event('online'));
  visibility.dispatchEvent(new Event('visibilitychange'));
  await work;
  const afterDefinite = requests;
  controller.stop();
  online.dispatchEvent(new Event('online'));
  await work;
  dispose();
  visible = false;
  assert({
    given: 'actual online/visible events after400 and terminal stop',
    should: 'leave automatic recovery stopped and dispose both listeners',
    actual: [afterDefinite, requests],
    expected: [1, 1],
  });
});

test('event storms do not replace a flight, and disposed account lifetimes cannot receive later events', async () => {
  const online = new EventTarget(),
    visibility = new EventTarget();
  const gate = Promise.withResolvers<unknown>();
  let oldRequests = 0,
    newRequests = 0;
  const old = createMediaController({
    roundId: admission.roundId,
    api: {
      admit: async () => {
        oldRequests++;
        if (oldRequests === 1) throw mediaFailure(503);
        return gate.promise;
      },
      reconcile: async () => snapshot,
    },
    transport: transportStub,
    changed: () => undefined,
    recovery,
  });
  let flight: Promise<void> = Promise.resolve();
  const disposeOld = subscribeMediaRecovery({
    online,
    visibility,
    isVisible: () => true,
    nudge: () => {
      flight = old.nudge();
    },
  });
  await old.join();
  online.dispatchEvent(new Event('online'));
  const started = flight;
  online.dispatchEvent(new Event('online'));
  visibility.dispatchEvent(new Event('visibilitychange'));
  const duringFlight = oldRequests;
  disposeOld();
  old.stop();
  const next = createMediaController({
    roundId: admission.roundId,
    api: {
      admit: async () => {
        newRequests++;
        return admission;
      },
      reconcile: async () => snapshot,
    },
    transport: transportStub,
    changed: () => undefined,
    recovery,
  });
  const disposeNext = subscribeMediaRecovery({
    online,
    visibility,
    isVisible: () => true,
    nudge: () => {
      flight = next.nudge();
    },
  });
  await next.join();
  online.dispatchEvent(new Event('online'));
  gate.resolve(admission);
  await started;
  await flight;
  assert({
    given:
      'a transient paused old account, a held admission, repeated actual events, then account-lifetime replacement and a late completion',
    should:
      'coalesce events without replacing a flight, keep the retired controller ended and leave the new live controller untouched',
    actual: [duringFlight, oldRequests, newRequests, old.state(), next.state()],
    expected: [2, 2, 1, 'ended', 'live'],
  });
  disposeNext();
  next.stop();
});
