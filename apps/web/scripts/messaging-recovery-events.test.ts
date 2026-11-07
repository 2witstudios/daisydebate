import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Request, Response } from '@playwright/test';
import { createRecoveryRequestEvents } from '../e2e/support/messaging-recovery-events';
setupRitewayBun();
const request = () =>
  ({ url: () => 'https://example.invalid/same' }) as unknown as Request;
const response = (incoming: Request) =>
  ({ request: () => incoming }) as unknown as Response;

test('a terminal event before response selection remains correlated by actual request identity', () => {
  let time = 10;
  const events = createRecoveryRequestEvents(() => time);
  const req = request(),
    res = response(req);
  events.request(req);
  events.response(res);
  events.failed(req, 'net::ERR_ABORTED');
  time = 10; // Same millisecond: real-process sequence still distinguishes entry.
  const step = events.step();
  const observed = events.snapshot(res, step, 100);
  assert({
    given: 'a failed request is observed before the response is later selected',
    should:
      'retain the exact request/Page response association and pre-entry failure',
    actual: {
      found: observed.recordFound,
      failed: observed.failedCount,
      finished: observed.finishedCount,
      kind: observed.eventKind,
      sameRequest: observed.failedSameRequest,
      sameResponse: observed.failedSamePageResponse,
      reason: observed.failureCategory,
      stage: observed.failedStage,
      rawSdk: observed.nativeNullableResponsePayload,
    },
    expected: {
      found: true,
      failed: 1,
      finished: 0,
      kind: 'failed',
      sameRequest: true,
      sameResponse: true,
      reason: 'aborted',
      stage: 'before-step-entry',
      rawSdk: 'NOT_CAPTURED',
    },
  });
});

test('an unrelated request with the same URL cannot supply selected terminal credit', () => {
  const events = createRecoveryRequestEvents(() => 10);
  const selected = request(),
    other = request(),
    unseen = request();
  events.request(selected);
  events.response(response(selected));
  events.request(other);
  events.failed(other, 'net::ERR_ABORTED');
  const step = events.step();
  const known = events.snapshot(response(selected), step, 100);
  const unknown = events.snapshot(response(unseen), step, 100);
  assert({
    given: 'only another SDK request has a terminal event',
    should:
      'preserve known zero separately from an unobserved request without borrowing terminal credit',
    actual: {
      known: [
        known.recordFound,
        known.failedCount,
        known.finishedCount,
        known.eventKind,
      ],
      unknown: [
        unknown.recordFound,
        unknown.failedCount,
        unknown.finishedCount,
        unknown.sameSelectedRequest,
      ],
    },
    expected: {
      known: [true, 0, 0, 'none'],
      unknown: [false, null, null, null],
    },
  });
});

test('finished and failed events retain separate counts, timing and closed failure categories', () => {
  let time = 100;
  const events = createRecoveryRequestEvents(() => time);
  const req = request(),
    res = response(req);
  events.request(req);
  events.response(res);
  const step = events.step();
  time = 110;
  events.finished(req);
  const finished = events.snapshot(res, step, 200);
  time = 210;
  events.failed(req, 'private unrecognized failure data');
  const both = events.snapshot(res, step, 200);
  assert({
    given:
      'a finished event within the step and a distinct failed event after the budget',
    should:
      'never treat failure as successful completion or expose unknown failure text',
    actual: {
      first: [
        finished.finishedCount,
        finished.failedCount,
        finished.eventKind,
        finished.finishedStage,
      ],
      both: [
        both.finishedCount,
        both.failedCount,
        both.eventKind,
        both.failedStage,
        both.failureCategory,
      ],
      privateLeaked: JSON.stringify(both).includes('private unrecognized'),
    },
    expected: {
      first: [1, 0, 'finished', 'within-step-budget'],
      both: [1, 1, 'both', 'after-step-budget-before-capture', 'other'],
      privateLeaked: false,
    },
  });
});

test('later terminal callbacks cannot rewrite an already captured snapshot', () => {
  let time = 100;
  const events = createRecoveryRequestEvents(() => time);
  const req = request(),
    res = response(req);
  events.request(req);
  events.response(res);
  const step = events.step();
  const before = events.snapshot(res, step, 200);
  const serialized = JSON.stringify(before);
  time = 210;
  events.failed(req, 'net::ERR_ABORTED');
  assert({
    given: 'a terminal callback arrives after the diagnostic was captured',
    should:
      'leave the earlier receipt unchanged while a later snapshot sees the event',
    actual: {
      unchanged: JSON.stringify(before) === serialized,
      frozen: Object.isFrozen(before),
      oldCount: before.failedCount,
      laterCount: events.snapshot(res, step, 200).failedCount,
    },
    expected: { unchanged: true, frozen: true, oldCount: 0, laterCount: 1 },
  });
});

test('Page response identity is distinct from SDK request identity and raw nullable payload', () => {
  const events = createRecoveryRequestEvents(() => 10);
  const req = request(),
    mapped = response(req),
    selected = response(req);
  events.request(req);
  events.response(mapped);
  events.finished(req);
  const observed = events.snapshot(selected, events.step(), 100);
  assert({
    given:
      'the same request has a different already observed Page response object',
    should:
      'record the response mismatch without inventing raw SDK nullable-event evidence',
    actual: [
      observed.sameSelectedRequest,
      observed.samePageResponse,
      observed.finishedSameRequest,
      observed.finishedSamePageResponse,
      observed.nativeNullableResponsePayload,
    ],
    expected: [true, false, true, false, 'NOT_CAPTURED'],
  });
});

test('a nullable public Page mapping never becomes raw SDK nullable-event evidence', () => {
  const events = createRecoveryRequestEvents(() => 10);
  const req = request(),
    res = response(req);
  events.request(req);
  events.failed(req, 'net::ERR_ABORTED');
  events.response(res);
  const observed = events.snapshot(res, events.step(), 100);
  assert({
    given: 'the terminal event precedes the public Page response association',
    should:
      'keep that earlier null association distinct from the later selected response and unknown raw SDK payload',
    actual: [
      observed.samePageResponse,
      observed.failedPageResponseIsNull,
      observed.failedSamePageResponse,
      observed.nativeNullableResponsePayload,
    ],
    expected: [true, true, null, 'NOT_CAPTURED'],
  });
});
