import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  assessNativePublicationEvidence,
  createNativePublicationEvidence,
} from '../integration/publication-evidence.test-support';

setupRitewayBun();
const complete = {
  eligibleSamples: 9600,
  complete: true,
  segmentEnded: false,
  stop: null,
} as const;
const clockStop = {
  eligibleSamples: 0,
  complete: false,
  segmentEnded: false,
  stop: 'clock',
} as const;

/** Protocol controls only; actual writer/native event production is proved separately. */
function evidence(throwAfterTerminal = false) {
  const proof = createNativePublicationEvidence((event) => {
    if (throwAfterTerminal && event.kind === 'terminal')
      throw Error('synthetic terminal failure');
  });
  proof.observer.observe({
    kind: 'clock',
    phase: 'initial',
    decision: 'accepted',
    anchorMs: 0,
    clockSamples: 0,
    sampleRate: 48000,
    sentAtMs: 0,
    receivedAtMs: 0,
    serverNowMs: 1000,
    precisionMs: 1,
    precisionPresent: 1,
  });
  return proof;
}
function terminal(proof: ReturnType<typeof evidence>, outcome = complete) {
  proof.observer.observe({
    kind: 'terminal',
    eligibleSamples: outcome.eligibleSamples,
    complete: outcome.complete ? 1 : 0,
    segmentEnded: 0,
    cancelled: 0,
    stop: outcome.stop,
  });
}
function happy(proof: ReturnType<typeof evidence>) {
  for (let index = 0; index < 20; index++) {
    proof.observer.observe({
      kind: 'cadence',
      decision: 'ready',
      dueMs: (index + 1) * 10,
      observedAtMs: (index + 1) * 10,
      clockSamples: index * 480,
    });
    proof.observer.observe({
      kind: 'receipt',
      decision: 'accepted',
      clockSamples: index * 480,
      anchorMs: 0,
      sampleRate: 48000,
      startSample: index * 480,
      endSample: (index + 1) * 480,
      beforeMs: (index + 1) * 10,
      afterMs: (index + 1) * 10 + 1,
      dueMs: (index + 1) * 10,
      calibrationReceivedAtMs: 0,
      windowBeforeMs: 1000 + index * 10,
      windowAfterMs: 1000 + (index + 1) * 10 + 1,
    });
    proof.observer.observe({
      kind: 'authorization',
      decision: 'allowed',
      beforeMs: 1000 + index * 10,
      afterMs: 1000 + (index + 1) * 10 + 1,
      sourceSamples: (index + 1) * 480,
      cancelled: 0,
    });
  }
  terminal(proof);
}
function rejected(proof: ReturnType<typeof evidence>) {
  proof.observer.observe({
    kind: 'cadence',
    decision: 'ready',
    dueMs: 10,
    observedAtMs: 10,
    clockSamples: 0,
  });
  proof.observer.observe({
    kind: 'receipt',
    decision: 'receipt.late',
    clockSamples: 0,
    anchorMs: 0,
    sampleRate: 48000,
    startSample: 0,
    endSample: 480,
    beforeMs: 10,
    afterMs: 111,
    dueMs: 10,
    calibrationReceivedAtMs: 0,
    windowBeforeMs: undefined,
    windowAfterMs: undefined,
  });
  proof.observer.observe({
    kind: 'terminal',
    eligibleSamples: 0,
    complete: 0,
    segmentEnded: 0,
    cancelled: 0,
    stop: 'clock',
  });
}

test('ledger corruption cannot substitute counts for source and history evidence', () => {
  const proof = evidence();
  happy(proof);
  const snapshot = proof.snapshot();
  const mutations = [
    snapshot.events.map((event) => ({
      kind: event.kind,
      sequence: event.sequence,
      ...('decision' in event ? { decision: event.decision } : {}),
      ...('phase' in event ? { phase: event.phase } : {}),
      ...(event.kind === 'terminal' ? event : {}),
    })),
    snapshot.events.map((event) =>
      event.kind === 'receipt'
        ? {
            ...snapshot.events.find((item) => item.kind === 'receipt')!,
            sequence: event.sequence,
          }
        : event.kind === 'authorization'
          ? {
              ...snapshot.events.find((item) => item.kind === 'authorization')!,
              sequence: event.sequence,
            }
          : event,
    ),
    snapshot.events.filter((event) => event.kind !== 'cadence'),
    snapshot.events.map((event) =>
      event.kind === 'authorization'
        ? {
            ...event,
            sourceSamples:
              event.sourceSamples === 480 ? 9600 : event.sourceSamples,
          }
        : event,
    ),
    snapshot.events.filter(
      (event) =>
        !(event.kind === 'authorization' && event.sourceSamples === 480),
    ),
    snapshot.events.map((event, index, events) =>
      index === 2 ? events[3]! : index === 3 ? events[2]! : event,
    ),
    snapshot.events.map((event) =>
      event.kind === 'clock' ? { ...event, sentAtMs: 'NaN' } : event,
    ),
    snapshot.events.map((event) =>
      event.kind === 'authorization' ? { ...event, beforeMs: 0 } : event,
    ),
  ];
  assert({
    given:
      'missing numeric fields, duplicated prefixes, missing cadence, substituted history, absent history or reordered events',
    should:
      'reject every corrupted ledger despite edited sequence and delivery counts',
    actual: mutations.map(
      (events) =>
        assessNativePublicationEvidence(
          {
            events: events.map((event, sequence) => ({
              ...event,
              sequence,
            })) as never,
            delivery: { state: 'valid', delivered: events.length },
          },
          complete,
          'complete',
        ).state === 'confirmed',
    ),
    expected: mutations.map(() => false),
  });
});

test('only a complete native qualification record confirms complete credit', () => {
  const proof = evidence();
  happy(proof);
  assert({
    given:
      'twenty source-decision and real-history decision records plus matching terminal result',
    should:
      'confirm the recorded complete qualification without treating transport as credit',
    actual: proof.assess(complete, 'complete'),
    expected: { state: 'confirmed', decision: 'complete' },
  });
});

test('matching terminal and public totals cannot contradict the authorized ledger', () => {
  const proof = evidence();
  happy(proof);
  const snapshot = proof.snapshot();
  const events = snapshot.events.map((event) =>
    event.kind === 'terminal' ? { ...event, eligibleSamples: 0 } : event,
  );
  assert({
    given:
      'a complete ledger with terminal and public result both substituted to zero credit',
    should:
      'reject totals inconsistent with its actual authorized source prefix',
    actual: assessNativePublicationEvidence(
      { ...snapshot, events },
      { ...complete, eligibleSamples: 0 },
      'complete',
    ).state,
    expected: 'invalid',
  });
});

test('omitted observation and terminal presence alone never confirm a happy job', () => {
  const absent = createNativePublicationEvidence();
  const onlyTerminal = evidence();
  terminal(onlyTerminal);
  assert({
    given:
      'no observations or a terminal result without source and history evidence',
    should: 'report incomplete evidence rather than a diagnostic pass',
    actual: [
      absent.assess(complete, 'complete').state,
      onlyTerminal.assess(complete, 'complete').state,
    ],
    expected: ['incomplete', 'incomplete'],
  });
});

test('missing actual guard records and a wrong expected reason cannot label a clock stop', () => {
  const proof = evidence();
  rejected(proof);
  const snapshot = proof.snapshot();
  const events = snapshot.events
    .filter((event) => event.kind !== 'receipt')
    .map((event, sequence) => ({ ...event, sequence }));
  assert({
    given:
      'an actual late receipt, its record removed, or an incorrectly named early fault',
    should:
      'confirm only the recorded actual reason and reject missing or mislabeled evidence',
    actual: [
      proof.assess(clockStop, 'receipt.late'),
      assessNativePublicationEvidence(
        {
          ...snapshot,
          events,
          delivery: { state: 'valid', delivered: events.length },
        },
        clockStop,
        'receipt.late',
      ).state,
      proof.assess(clockStop, 'receipt.early').state,
    ],
    expected: [
      { state: 'confirmed', decision: 'receipt.late' },
      'incomplete',
      'invalid',
    ],
  });
});

test('terminal callback failure invalidates evidence even after a cached valid status', () => {
  const proof = evidence(true);
  const cached = proof.snapshot().delivery;
  happy(proof);
  assert({
    given:
      'a collector storing terminal then throwing after an earlier valid status snapshot',
    should:
      'read final sticky handle invalidity instead of trusting terminal or cached status',
    actual: {
      cached: cached.state,
      evidence: proof.assess(complete, 'complete').state,
    },
    expected: { cached: 'valid', evidence: 'invalid' },
  });
});

test('truncated and malformed evidence cannot produce a diagnostic pass', () => {
  const truncated = evidence();
  for (let index = 0; index < 65; index++) terminal(truncated);
  const malformed = evidence();
  malformed.observer.observe({
    ...{ kind: 'terminal', token: 'must-not-be-delivered' },
  } as never);
  assert({
    given:
      'a bounded collector exceeding its cap or receiving an unexpected nonnumeric payload',
    should: 'retain invalidity rather than confirm either record',
    actual: [
      truncated.assess(complete, 'complete').state,
      malformed.assess(complete, 'complete').state,
    ],
    expected: ['invalid', 'invalid'],
  });
});
