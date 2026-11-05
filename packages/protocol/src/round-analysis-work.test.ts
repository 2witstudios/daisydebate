import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleRoundAnalysisReport as report } from './round-analysis.test-support';
import { analysisWorkSchema, type AnalysisWork } from './round-analysis-work';
import {
  advanceAnalysisWork as advance,
  analysisUsageOutcome,
} from './round-analysis-lifecycle';
import {
  at,
  context,
  step,
  lease,
  claimed,
  queued,
  dispatch,
  observe,
  received,
  id,
  digest,
  history,
  requestId,
} from './round-analysis-work.test-support';
setupRitewayBun();

test('the persisted analysis contract rejects impossible claim, call and chronology facts', () => {
  const state = dispatch(claimed(), 1);
  if (state.kind !== 'leased') throw Error('Fixture must be leased');
  const call = state.calls[0]!;
  const invalid: unknown[] = [
    { ...state, calls: [call, call] },
    { ...state, claims: 0 },
    { ...state, calls: [{ ...call, dispatchedAt: at(900) }] },
    { ...state, requestedAt: at(1) },
    { ...state, lease: { ...state.lease, claimedAt: at(1) } },
    { ...state, lease: { ...state.lease, expiresAt: at(181) } },
    { ...state, lease: { ...state.lease, tokenDigest: digest(2) } },
    { ...state, historical: { ...history, claimedAttempts: 2 } },
    { ...state, historical: { ...history, completedAt: at(1) } },
    {
      kind: 'queued',
      requestId,
      requestedAt: at(0),
      deadlineAt: at(900),
      evidenceLines: 1,
      claims: 4,
      calls: [],
      historical: null,
    },
  ];
  assert({
    given:
      'duplicate calls, missing claim, backdated request/lease, oversized lease, mismatched token, spent historical capacity, terminal history and exhausted claims',
    should:
      'refuse every impossible persisted state while accepting actual dispatched work',
    actual: [
      analysisWorkSchema.safeParse(state).success,
      ...invalid.map((value) => analysisWorkSchema.safeParse(value).success),
    ],
    expected: [true, ...invalid.map(() => false)],
  });
});

test('clock reversals and replacement leases cannot regain dispatch authority', () => {
  const leased = step(queued(), { kind: 'claim', lease: lease(1) }, 1);
  const replaced = step(leased, { kind: 'claim', lease: lease(2) }, 30);
  const attempt = {
    kind: 'dispatch',
    callId: id(1),
    tokenDigest: digest(1),
  } as const;
  assert({
    given:
      'a backdated operation, a bounded lease replaced after expiry, and old lease identifiers offered again',
    should: 'refuse old work and permit only the freshly claimed call',
    actual: [
      advance(leased, attempt, context(0)).kind,
      advance(leased, attempt, context(30)).kind,
      advance(replaced, attempt, context(30)).kind,
      advance(
        leased,
        { kind: 'claim', lease: { ...lease(1), expiresAt: at(60) } },
        context(30),
      ).kind,
      advance(
        leased,
        { kind: 'claim', lease: { ...lease(2), tokenDigest: digest(1) } },
        context(30),
      ).kind,
      advance(
        replaced,
        { ...attempt, callId: id(2), tokenDigest: digest(2) },
        context(30),
      ).kind,
    ],
    expected: ['refuse', 'refuse', 'refuse', 'refuse', 'refuse', 'changed'],
  });
});

test('received evidence replays by meaning and terminal timestamps survive content purge', () => {
  const state = observe(dispatch(claimed(), 1), 1, received, 1);
  const published = step(
    state,
    { kind: 'publish', callId: id(1), tokenDigest: digest(1), report },
    2,
  );
  const purged = step(published, { kind: 'purge' }, 3);
  assert({
    given:
      'the same provider outcome with reordered fields, then report publication and retention purge',
    should:
      'accept the replay and preserve request, completion and original call facts without report content',
    actual: [
      advance(
        state,
        {
          kind: 'observe',
          callId: id(1),
          tokenDigest: digest(1),
          outcome: { outputTokens: 20, inputTokens: 100, kind: 'received' },
        },
        context(1),
      ).kind,
      purged.kind === 'purged'
        ? [
            purged.request?.requestId,
            purged.request?.claims,
            purged.request?.calls.length,
            purged.completedAt,
            purged.purgedAt,
            'report' in purged,
          ]
        : null,
      advance(published, { kind: 'purge' }, context(1)).kind,
    ],
    expected: ['unchanged', [requestId, 1, 1, at(2), at(3), false], 'refuse'],
  });
});

test('historical delivered and erased identities remain terminal without generation evidence', () => {
  const states: AnalysisWork[] = [
    {
      kind: 'retained',
      historical: { ...history, completedAt: at(2) },
      report,
    },
    {
      kind: 'retired',
      historical: { ...history, completedAt: at(2), model: 'erased' },
      reason: 'erased',
    },
  ];
  assert({
    given:
      'a previously delivered report and an erasure tombstone with one synthetic old attempt',
    should:
      'preserve the original identity without requiring generation evidence or treating erasure as a call',
    actual: states.map((state) => [
      analysisWorkSchema.safeParse(state).success,
      advance(
        state,
        { kind: 'request', evidenceLines: 1, requestId },
        { ...context(3), evidenceAvailable: false },
      ).kind,
      advance(state, { kind: 'claim', lease: lease(1) }, context(3)).kind,
    ]),
    expected: [
      [true, 'unchanged', 'refuse'],
      [true, 'unchanged', 'refuse'],
    ],
  });
});

test('execution expiry fences new work without losing uncertain or never-dispatched accounting', () => {
  const untouched = queued();
  const started = dispatch(claimed(), 1);
  const now = 900;
  const expire = (state: AnalysisWork) =>
    step(
      state,
      { kind: 'claim', lease: { ...lease(2), expiresAt: at(now + 30) } },
      now,
    );
  const states = [expire(untouched), expire(started)];
  assert({
    given:
      'a fifteen-minute request deadline crossed during outage, with zero versus one unknown dispatch',
    should:
      'retire both requests without fabricating service or relieving unknown exposure',
    actual: states.map((state) => [
      state.kind,
      state.kind === 'failed' ? state.reason : null,
      analysisUsageOutcome(state),
      advance(
        state,
        { kind: 'request', evidenceLines: 1, requestId },
        context(now),
      ).kind,
    ]),
    expected: [
      ['failed', 'expired', 'unspent', 'unchanged'],
      ['failed', 'expired', 'unknown', 'unchanged'],
    ],
  });
});

test('invalid and overflowing injected clocks refuse without throwing or minting work', () => {
  assert({
    given: 'an invalid clock and the last representable JavaScript instant',
    should: 'return a total refusal before constructing a request deadline',
    actual: ['invalid', '+275760-09-13T00:00:00.000Z'].map(
      (now) =>
        advance(
          null,
          { kind: 'request', requestId, evidenceLines: 1 },
          { ...context(), now },
        ).kind,
    ),
    expected: ['refuse', 'refuse'],
  });
});
