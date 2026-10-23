import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { dispatchMediaMutation, mediaMutationOutcome } from './vendor-dispatch';
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
    outcome: () => 'unknown',
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

test('a provider error is settled when it proves the outcome, and only an unknown one stays pending (ISSUE-464)', async () => {
  const notFound = createAppError('NOT_FOUND', 'gone');
  const refused = createAppError('CONFLICT', 'refused');
  const unknown = createAppError('INFRASTRUCTURE', 'down');
  assert({
    given: 'not found, a refusal and an unknown error for each mutation kind',
    should:
      'treat not found on delete as done, other definite errors as failed, and the rest as unknown',
    actual: (['delete', 'create', 'permissions'] as const).map((kind) => [
      mediaMutationOutcome(kind, notFound),
      mediaMutationOutcome(kind, refused),
      mediaMutationOutcome(kind, unknown),
      mediaMutationOutcome(kind, new TypeError('fetch failed')),
    ]),
    expected: [
      ['succeeded', 'failed', 'unknown', 'unknown'],
      ['failed', 'failed', 'unknown', 'unknown'],
      ['failed', 'failed', 'unknown', 'unknown'],
    ],
  });
  const events: string[] = [];
  const result = await dispatchMediaMutation({
    persist: async () => 'intent',
    dispatch: async () => {
      throw refused;
    },
    outcome: (error) => mediaMutationOutcome('permissions', error),
    settle: async (_id, outcome) => {
      events.push(`settle ${outcome}`);
    },
    unsafe: async () => {
      events.push('unsafe');
    },
    deadline: (work) => work,
    reporter: { capture: () => events.push('report') },
    requestId: 'request-1',
  });
  assert({
    given: 'a definite provider refusal',
    should: 'settle it failed without marking the session unsafe',
    actual: { result, events },
    expected: { result: { acknowledged: false }, events: ['settle failed'] },
  });
});
