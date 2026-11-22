import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaSupersessionProbe } from '../apps/web/e2e/support/media-supersession-probe';

setupRitewayBun();

test('the preserved slow setup can arm without another pre-yield request', () => {
  let now = 0;
  const probe = createMediaSupersessionProbe<object>({
    now: () => now,
    minBaselineAgeMs: 1500,
  });
  const setup = {};
  const baseline = {};
  const young = {};
  const fresh = {};
  probe.start(setup);
  now = 578;
  probe.start(baseline);
  now = 900;
  assert({
    given:
      'a held read too young to finish before the countdown deadline after supersession',
    should: 'not arm prematurely',
    actual: probe.arm(),
    expected: false,
  });
  now = 2445;
  // No new request has occurred since 578: the exact stale setup premise.
  const beforeYieldCount = probe.observed.length;
  const armed = probe.arm();
  now = 2578;
  probe.finish(baseline);
  probe.start(young);
  now = 2600;
  probe.finish(setup);
  now = 4578;
  probe.start(fresh);
  const [superseded, held, next] = probe.window;
  const deadline = 3460;
  assert({
    given:
      'the original 1867ms-old baseline at yield, its supersession and next recovery read',
    should:
      'complete the original timing assertions without requiring any new pre-yield request',
    actual: [
      armed,
      beforeYieldCount,
      superseded!.startedAt,
      superseded!.endedAt !== null,
      held!.startedAt < deadline,
      next!.startedAt > deadline,
      next!.startedAt - held!.startedAt > 1900,
      next!.startedAt - held!.startedAt < 2500,
    ],
    expected: [true, 2, 578, true, true, true, true, true],
  });
});

test('out-of-order request failure updates its own lifetime', () => {
  let now = 0;
  const probe = createMediaSupersessionProbe<object>({
    now: () => now,
    minBaselineAgeMs: 1500,
  });
  const first = {};
  const second = {};
  probe.start(first);
  now = 50;
  probe.start(second);
  now = 100;
  probe.finish(second);
  assert({
    given: 'the second request fails while the first is still held',
    should: 'leave the first lifetime pending',
    actual: probe.observed.map((read) => read.endedAt),
    expected: [null, 100],
  });
  now = 200;
  probe.finish(first);
  assert({
    given: 'the first request fails later',
    should: 'retain each actual failure instant',
    actual: probe.observed.map((read) => read.endedAt),
    expected: [200, 100],
  });
});
