import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleRoundAnalysisReport as report } from './round-analysis.test-support';
import { analysisWorkSchema, type AnalysisWork } from './round-analysis-work';
import {
  advanceAnalysisWork as advance,
  analysisUsageOutcome,
} from './round-analysis-lifecycle';

setupRitewayBun();
import {
  id,
  digest,
  context,
  lease,
  step,
  queued,
  claimed,
  dispatch,
  received,
  failed,
  observe,
  history,
} from './round-analysis-work.test-support';

test('analysis request and first dispatch have separate durable authority', () => {
  const unrequested: AnalysisWork = {
    kind: 'unrequested',
    historical: history,
  };
  const leased = claimed();
  const dispatched = dispatch(leased, 1);
  assert({
    given:
      'no request, a retired automatic lease, a new claim, then duplicate dispatch and request',
    should:
      'never auto-claim, count only the first model call and retain one request identity',
    actual: [
      advance(null, { kind: 'claim', lease: lease(1) }, context()).kind,
      advance(unrequested, { kind: 'claim', lease: lease(1) }, context()).kind,
      'calls' in leased ? leased.calls.length : -1,
      'calls' in dispatched ? dispatched.calls.length : -1,
      advance(
        dispatched,
        { kind: 'dispatch', callId: id(1), tokenDigest: digest(1) },
        context(),
      ).kind,
      advance(
        dispatched,
        { kind: 'request', evidenceLines: 1, requestId: id(9) },
        context(),
      ).kind,
    ],
    expected: ['refuse', 'refuse', 0, 1, 'unchanged', 'unchanged'],
  });
  assert({
    given: 'expired, wrong-token, erased or missing-evidence first dispatch',
    should: 'leave the claimed state unchanged and authorize no provider call',
    actual: [
      advance(
        leased,
        { kind: 'dispatch', callId: id(1), tokenDigest: digest(1) },
        context(30),
      ),
      advance(
        leased,
        { kind: 'dispatch', callId: id(1), tokenDigest: digest(2) },
        context(),
      ),
      advance(
        leased,
        { kind: 'dispatch', callId: id(1), tokenDigest: digest(1) },
        { ...context(), authorized: false },
      ),
      advance(
        leased,
        { kind: 'dispatch', callId: id(1), tokenDigest: digest(1) },
        { ...context(), evidenceAvailable: false },
      ),
    ].map((result) => result.kind),
    expected: ['refuse', 'refuse', 'refuse', 'refuse'],
  });
});

test('unknown calls survive lease death and late evidence cannot regain report authority', () => {
  const first = dispatch(claimed(), 1);
  const second = dispatch(
    step(first, { kind: 'claim', lease: lease(2) }, 30),
    2,
    30,
  );
  const terminal = step(second, { kind: 'claim', lease: lease(3) }, 60);
  const knownOne = observe(terminal, 2, received, 60);
  const knownAll = observe(knownOne, 1, failed, 61);
  assert({
    given:
      'two dispatched calls with lost responses, then late received/nonservice evidence',
    should:
      'exhaust the bounded work honestly, settle unknown until all calls resolve and never publish with old authority',
    actual: [
      terminal.kind,
      analysisUsageOutcome(terminal),
      analysisUsageOutcome(knownOne),
      analysisUsageOutcome(knownAll),
      advance(
        knownAll,
        { kind: 'publish', callId: id(2), tokenDigest: digest(2), report },
        context(61),
      ).kind,
      advance(
        knownAll,
        { kind: 'request', evidenceLines: 1, requestId: id(9) },
        context(61),
      ).kind,
    ],
    expected: [
      'failed',
      'unknown',
      'unknown',
      'delivered',
      'refuse',
      'unchanged',
    ],
  });
});

test('only terminal all-definite nonservice permits requested-use restoration', () => {
  let state = observe(dispatch(claimed(), 1), 1, failed);
  const pending = analysisUsageOutcome(state);
  state = step(state, { kind: 'retry', callId: id(1), tokenDigest: digest(1) });
  state = dispatch(step(state, { kind: 'claim', lease: lease(2) }), 2);
  state = observe(state, 2, failed);
  state = step(state, { kind: 'retry', callId: id(2), tokenDigest: digest(2) });
  assert({
    given:
      'two definitely unserved requested calls, with a retry still possible after the first',
    should:
      'defer relief until terminal and refuse contradictory late accounting',
    actual: [
      pending,
      state.kind,
      analysisUsageOutcome(state),
      advance(
        state,
        {
          kind: 'observe',
          callId: id(2),
          tokenDigest: digest(2),
          outcome: failed,
        },
        context(),
      ).kind,
      advance(
        state,
        {
          kind: 'observe',
          callId: id(2),
          tokenDigest: digest(2),
          outcome: received,
        },
        context(),
      ).kind,
      advance(
        state,
        {
          kind: 'observe',
          callId: id(2),
          tokenDigest: digest(9),
          outcome: failed,
        },
        context(),
      ).kind,
    ],
    expected: [
      'pending',
      'failed',
      'definite_failure',
      'unchanged',
      'refuse',
      'refuse',
    ],
  });
});

test('an invalid received report and privacy removal never make service free or reopen the seat', () => {
  const answered = observe(dispatch(claimed(), 1), 1, received);
  const published = step(answered, {
    kind: 'publish',
    callId: id(1),
    tokenDigest: digest(1),
    report,
  });
  const purged = step(published, { kind: 'purge' });
  const denied = step(answered, { kind: 'close', reason: 'evidence' });
  assert({
    given:
      'received service without publishable evidence and a previously delivered report purged',
    should:
      'preserve paid service, remove report content and retain terminal identity',
    actual: [
      analysisUsageOutcome(denied),
      purged.kind,
      'report' in purged,
      analysisUsageOutcome(purged),
      advance(
        purged,
        { kind: 'request', evidenceLines: 1, requestId: id(9) },
        context(),
      ).kind,
    ],
    expected: ['delivered', 'purged', false, 'delivered', 'unchanged'],
  });
});

test('nondispatch crashes have bounded leases and never manufacture a counted call', () => {
  let state = queued();
  for (let n = 1; n <= 4; n++) {
    state = step(state, { kind: 'claim', lease: lease(n) });
    state = step(state, {
      kind: 'retry',
      callId: id(n),
      tokenDigest: digest(n),
    });
  }
  assert({
    given: 'four crashed or cancelled lease claims before provider I/O',
    should:
      'end bounded work with no dispatch, unknown use or fabricated refund',
    actual: [
      state.kind,
      analysisUsageOutcome(state),
      'claims' in state ? state.claims : -1,
      'calls' in state ? state.calls : null,
      analysisWorkSchema.safeParse(state).success,
    ],
    expected: ['failed', 'unspent', 4, [], true],
  });
});
