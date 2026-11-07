import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { APIResponse, Route, TestInfo } from '@playwright/test';
import { readControlledRefusal } from '../e2e/support/messaging-controlled-refusal';
setupRitewayBun();
const flight =
  '7:I[1,[],"ConversationReconnecting"]\n0:["$","$L7",null,{"requestId":"cccccccccccccccccccccccc","retryAfterMs":1000}]\n';
const response = (
  status = 200,
  contentType = 'text/x-component',
  payload = flight,
) =>
  ({
    status: () => status,
    headers: () => ({ 'content-type': contentType }),
    text: async () => payload,
  }) as unknown as APIResponse;
const info = { attach: async () => {} } as unknown as TestInfo;

test('controlled refusal reads once without retries or redirects and retains the actual response identity', async () => {
  const actual = response();
  const calls: unknown[] = [];
  const route = {
    fetch: async (options: unknown) => {
      calls.push(options);
      return actual;
    },
  } as unknown as Route;
  const loaded = await readControlledRefusal(route, info, 1000);
  assert({
    given: 'one genuine advised Flight response from the route read',
    should:
      'perform one bounded nonredirecting read and return the original response',
    actual: {
      calls,
      sameResponse: loaded.response === actual,
      advised: loaded.advice.retryAfterMs,
    },
    expected: {
      calls: [{ timeout: 1000, maxRetries: 0, maxRedirects: 0 }],
      sameResponse: true,
      advised: 1000,
    },
  });
});

test('controlled delivery never releases a redirect, wrong MIME, permanent body or postdeadline read', async () => {
  const refused: boolean[] = [];
  for (const actual of [
    response(302),
    response(200, 'text/html'),
    response(200, 'text/x-component', '0:{}\n'),
  ]) {
    const route = { fetch: async () => actual } as unknown as Route;
    refused.push(
      await readControlledRefusal(route, info, 1000).then(
        () => false,
        () => true,
      ),
    );
  }
  let lateReads = 0;
  const late = {
    fetch: async () => {
      lateReads++;
      return response();
    },
  } as unknown as Route;
  const expired = await readControlledRefusal(late, info, 0).then(
    () => false,
    () => true,
  );
  assert({
    given: 'unexpected response semantics or an exhausted existing budget',
    should: 'refuse delivery and perform zero new reads after expiry',
    actual: { refused, expired, lateReads },
    expected: { refused: [true, true, true], expired: true, lateReads: 0 },
  });
});
