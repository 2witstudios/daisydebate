import { assert, setupRitewayBun, test } from 'riteway/bun';
import { dispatchMediaMutation } from './vendor-dispatch';
setupRitewayBun();
test('unknown vendor completion remains pending across the deadline and resolves only on acknowledgement', async () => {
  const provider = Promise.withResolvers<void>();
  const deadline = Promise.withResolvers<never>();
  const events: string[] = [];
  let recordedContext: unknown;
  const dispatch = dispatchMediaMutation({
    persist: async () => {
      events.push('persist');
      return 'opaque-intent';
    },
    dispatch: () => {
      events.push('dispatch');
      return provider.promise;
    },
    settle: async () => {
      events.push('settle');
    },
    unsafe: async () => {
      events.push('unsafe');
    },
    deadline: (work) => Promise.race([work, deadline.promise]),
    reporter: {
      capture: (_error, context) => {
        recordedContext = context;
        events.push('report');
      },
    },
    requestId: 'request-123',
  });
  await Promise.resolve();
  deadline.reject(new Error('deadline'));
  await dispatch;
  assert({
    given: 'a vendor deadline without cancellation evidence',
    should: 'persist before dispatch and retain unsafe pending state',
    actual: events,
    expected: ['persist', 'dispatch', 'unsafe', 'report'],
  });
  provider.resolve();
  await provider.promise;
  await Promise.resolve();
  await Promise.resolve();
  assert({
    given: 'the late actual acknowledgement',
    should: 'settle only then, without reopening admission',
    actual: events,
    expected: ['persist', 'dispatch', 'unsafe', 'report', 'settle'],
  });
  assert({
    given: 'an infrastructure failure',
    should:
      'send only controlled context with no round, seat or vendor identity',
    actual: recordedContext,
    expected: {
      requestId: 'request-123',
      route: '/api/rounds/:id/media/reconcile',
      errorCode: 'INFRASTRUCTURE',
    },
  });
});
