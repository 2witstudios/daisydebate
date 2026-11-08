import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  recordRecoveryPhase,
  recordRecoveryFailure,
} from '../e2e/support/messaging-recovery-phase';
import type { watchConversationRecovery } from '../e2e/support/messaging-recovery-evidence';
import type { Page, Response, TestInfo } from '@playwright/test';

setupRitewayBun();
const privateId = 'private-current-request';
const page = {
  getByText: () => ({
    count: async () => 1,
    evaluate: async () => ({
      requestId: privateId,
      diagnostic: { reason: 'settled', currentRoot: true },
    }),
  }),
} as unknown as Page;
const observer = {
  snapshot: () => ({ pending: 1, maximumPending: 2 }),
  consumer: () => ({ sameHttpCorrelation: true, eof: true }),
} as unknown as ReturnType<typeof watchConversationRecovery>;
const response = {
  headers: () => ({ 'x-request-id': privateId }),
} as unknown as Response;

test('phase evidence preserves precise relationships without serializing private correlation', async () => {
  let body = '';
  const info = {
    attach: async (_name: string, value: { body: string }) => {
      body = value.body;
    },
  } as unknown as TestInfo;
  await recordRecoveryPhase(info, page, observer, {
    phase: 'after-held-predicate',
    response,
    previous: 'private-previous-request',
  });
  const result = JSON.parse(body);
  assert({
    given:
      'a finished response with a current settled owner and a remaining request',
    should:
      'retain those distinct facts and only boolean identity relationships',
    actual: {
      privateValue: body.includes(privateId),
      owner: result.owner,
      pending: result.requests.pending,
      eof: result.consumer.eof,
    },
    expected: {
      privateValue: false,
      owner: {
        observed: true,
        sameAsPrevious: false,
        sameAsSelectedHttpId: true,
        readiness: { reason: 'settled', currentRoot: true },
      },
      pending: 1,
      eof: true,
    },
  });
});

test('a failed diagnostic cannot replace the actual predicate failure', async () => {
  const target = Error('actual predicate failed');
  const diagnostic = Error('attachment unavailable');
  const info = {
    attach: async () => {
      throw diagnostic;
    },
  } as unknown as TestInfo;
  const result = await recordRecoveryFailure(
    info,
    page,
    observer,
    {
      phase: 'after-held-predicate',
      response,
      previous: null,
    },
    target,
  ).catch((error) => error);
  assert({
    given: 'both the target predicate and its evidence attachment fail',
    should:
      'retain the target as cause and first error without hiding evidence failure',
    actual:
      result instanceof AggregateError &&
      result.cause === target &&
      result.errors[0] === target &&
      result.errors[1] === diagnostic,
    expected: true,
  });
});
