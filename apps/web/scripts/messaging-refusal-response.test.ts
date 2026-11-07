import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readRefusalResponse,
  refusalResponsePhase,
} from '../e2e/support/messaging-recovery-clock';
setupRitewayBun();

test('response phase records a pending finish without starting a body read', async () => {
  const finish = Promise.withResolvers<null>();
  const phase = refusalResponsePhase();
  let bodies = 0;
  const work = readRefusalResponse(
    {
      finished: () => finish.promise,
      text: async () => {
        bodies++;
        return 'fixture Flight';
      },
    },
    phase,
  );
  const pending = { ...phase };
  const bodyCallsBeforeFinish = bodies;
  finish.resolve(null);
  const body = await work;
  assert({
    given: 'the native finish promise is still pending',
    should: 'record only finish entry and never read the body early',
    actual: { phase: pending, bodyCallsBeforeFinish },
    expected: {
      phase: {
        finishedEntered: true,
        finishedReturned: false,
        finishedFailed: false,
        bodyEntered: false,
        bodyReturned: false,
        bodyFailed: false,
      },
      bodyCallsBeforeFinish: 0,
    },
  });
  assert({
    given: 'finish then body both resolve',
    should: 'record their ordered returns without changing the payload',
    actual: { body, bodies, phase },
    expected: {
      body: 'fixture Flight',
      bodies: 1,
      phase: {
        finishedEntered: true,
        finishedReturned: true,
        finishedFailed: false,
        bodyEntered: true,
        bodyReturned: true,
        bodyFailed: false,
      },
    },
  });
});

test('pending and failed body are distinct from pending finish and retain the exact error', async () => {
  const body = Promise.withResolvers<string>();
  const phase = refusalResponsePhase();
  const work = readRefusalResponse(
    { finished: async () => null, text: () => body.promise },
    phase,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const pending = { ...phase };
  const original = new Error('controlled body fault');
  body.reject(original);
  const sameError = await work.then(
    () => false,
    (error) => error === original,
  );
  assert({
    given: 'finish resolved but body remains pending then rejects',
    should: 'separate those phases and rethrow the identical body error',
    actual: { pending, sameError, bodyFailed: phase.bodyFailed },
    expected: {
      pending: {
        finishedEntered: true,
        finishedReturned: true,
        finishedFailed: false,
        bodyEntered: true,
        bodyReturned: false,
        bodyFailed: false,
      },
      sameError: true,
      bodyFailed: true,
    },
  });
});

test('a finish failure never starts body work or replaces its original error', async () => {
  const original = new Error('controlled finish fault');
  const phase = refusalResponsePhase();
  let bodies = 0;
  const sameError = await readRefusalResponse(
    {
      finished: async () => {
        throw original;
      },
      text: async () => {
        bodies++;
        return '';
      },
    },
    phase,
  ).then(
    () => false,
    (error) => error === original,
  );
  assert({
    given: 'the actual finish await rejects',
    should:
      'record its failure, preserve its identity and leave body unentered',
    actual: { sameError, bodies, phase },
    expected: {
      sameError: true,
      bodies: 0,
      phase: {
        finishedEntered: true,
        finishedReturned: false,
        finishedFailed: true,
        bodyEntered: false,
        bodyReturned: false,
        bodyFailed: false,
      },
    },
  });
});
