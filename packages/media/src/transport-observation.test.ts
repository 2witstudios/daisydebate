import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { TransportObservation } from './transport-observation/transport-observation';
import { TransportFixture } from './transport-observation.test-support';
setupRitewayBun();
const { row, setup } = TransportFixture;
describe('bounded track transport observation is not coverage', () => {
  test('whitelists exact counters and marks a first sample as a baseline', async () => {
    const s = setup([[row()]]);
    assert({
      given: 'one bound audio inbound record alongside arbitrary native fields',
      should:
        'return only exact bounded counters and local brackets, never raw report or source/hearing authority',
      actual: await s.observer.read(),
      expected: {
        kind: 'observed',
        binding: {
          incarnation: 'c'.repeat(24),
          trackId: 'TR_original',
          generation: 1,
        },
        startedAtMs: 1000,
        endedAtMs: 1005,
        baseline: true,
        counters: {
          packetsReceived: '10',
          packetsLost: '0',
          totalSamplesReceived: '20000',
          concealedSamples: '10000',
        },
      },
    });
  });
  test('stationary packets with growing decoder samples remain transport metadata', async () => {
    const s = setup([[row()], [row(10n, 'original', 30000n)]]);
    await s.observer.read();
    s.at(1500);
    const result = await s.observer.read();
    assert({
      given:
        'a later counter report with no packet increase but more decoded samples',
      should:
        'preserve the discrepancy without adding silence, continuity, hearing or coverage fields',
      actual: result,
      expected: {
        kind: 'observed',
        binding: {
          incarnation: 'c'.repeat(24),
          trackId: 'TR_original',
          generation: 1,
        },
        startedAtMs: 1500,
        endedAtMs: 1505,
        baseline: false,
        counters: {
          packetsReceived: '10',
          packetsLost: '0',
          totalSamplesReceived: '30000',
          concealedSamples: '10000',
        },
      },
    });
  });
  for (const [name, value, reason] of [
    ['missing', [], 'missing'],
    ['ambiguous', [row(), row()], 'ambiguous'],
    ['oversized', Array.from({ length: 513 }, () => row()), 'malformed'],
    ['malformed', [{ stats: { case: 'inboundRtp', value: {} } }], 'malformed'],
    ['negative', [row(-1n)], 'malformed'],
    ['too-large', [row(1n << 64n)], 'malformed'],
    [
      'wrong-kind',
      [
        {
          stats: {
            case: 'inboundRtp',
            value: {
              ...row().stats.value,
              stream: { kind: 'video', ssrc: 42 },
            },
          },
        },
      ],
      'malformed',
    ],
  ] as const)
    test(`${name} remains unknown`, async () => {
      const s = setup([value]);
      assert({
        given: `${name} native metadata`,
        should: 'refuse it without zero defaults or a room fallback',
        actual: await s.observer.read(),
        expected: { kind: 'unknown', reason },
      });
    });
  test('a negative packetsLost value is a valid signed observation', async () => {
    const lost = (value: bigint) => ({
      stats: {
        case: 'inboundRtp',
        value: {
          stream: { kind: 'audio', ssrc: 42 },
          received: { packetsReceived: 10n, packetsLost: value },
          inbound: {
            trackIdentifier: 'original',
            totalSamplesReceived: 20000n,
            concealedSamples: 10000n,
          },
        },
      },
    });
    assert({
      given: 'the native signed packetsLost counter at a negative value',
      should: 'observe it rather than rejecting the whole report as malformed',
      actual: await setup([[lost(-1n)]])
        .observer.read()
        .then((r) =>
          r.kind === 'observed' ? r.counters.packetsLost : r.reason,
        ),
      expected: '-1',
    });
  });
  test('a signed packetsLost decrease continues the baseline', async () => {
    const lost = (value: bigint) => ({
      stats: {
        case: 'inboundRtp',
        value: {
          stream: { kind: 'audio', ssrc: 42 },
          received: { packetsReceived: 10n, packetsLost: value },
          inbound: {
            trackIdentifier: 'original',
            totalSamplesReceived: 20000n,
            concealedSamples: 10000n,
          },
        },
      },
    });
    const s = setup([[row()], [lost(5n)], [lost(3n)]]);
    const outputs = [];
    for (let i = 0; i < 3; i++) {
      s.at(1000 + i * 500);
      outputs.push(await s.observer.read());
    }
    assert({
      given: 'late duplicates reducing only the signed packetsLost counter',
      should:
        'keep the same baseline without treating the decrease as a stream reset',
      actual: outputs.map((r) =>
        r.kind === 'unknown' ? r.reason : r.baseline,
      ),
      expected: [true, false, false],
    });
  });
  test('counter resets and missing reports break the baseline', async () => {
    const s = setup([[row()], [row(1n)], [], [row(2n)]]);
    const outputs = [];
    for (let i = 0; i < 4; i++) {
      s.at(1000 + i * 500);
      outputs.push(await s.observer.read());
    }
    assert({
      given: 'a backwards counter then a missing report followed by new data',
      should:
        'expose reset/missing and start a new baseline without bridging the unknown interval',
      actual: outputs.map((r) =>
        r.kind === 'unknown' ? r.reason : r.baseline,
      ),
      expected: [true, 'reset', 'missing', true],
    });
  });
  test('native record replacement permanently refuses the old binding', async () => {
    const s = setup([
      [row()],
      [row(11n, 'replacement')],
      [row(12n, 'replacement')],
    ]);
    await s.observer.read();
    s.at(1500);
    const replaced = await s.observer.read();
    s.at(2000);
    const again = await s.observer.read();
    assert({
      given: 'a different native identity on the same caller binding',
      should: 'require a new binding and stop further native reads',
      actual: { replaced, again, calls: s.calls() },
      expected: {
        replaced: { kind: 'unknown', reason: 'replaced' },
        again: { kind: 'unknown', reason: 'replaced' },
        calls: 2,
      },
    });
  });
  test('close fences a response already held by the caller', async () => {
    const held = Promise.withResolvers<unknown>();
    let calls = 0,
      signal: AbortSignal | undefined;
    const o = TransportObservation.create({
      binding: {
        incarnation: 'c'.repeat(24),
        trackId: 'TR_original',
        generation: 1,
      },
      nowMs: () => 1000,
      readStats: async (options) => {
        calls++;
        signal = options.signal;
        return held.promise;
      },
    });
    const pending = o.read();
    o.close();
    held.resolve([row()]);
    assert({
      given:
        'an outstanding request whose source ignores cancellation and returns after close',
      should:
        'abort future work and discard the late metadata without reopening the binding',
      actual: {
        result: await pending,
        again: await o.read(),
        aborted: signal?.aborted,
        calls,
      },
      expected: {
        result: { kind: 'unknown', reason: 'closed' },
        again: { kind: 'unknown', reason: 'closed' },
        aborted: true,
        calls: 1,
      },
    });
  });
  test('concurrent and early polls cannot multiply native work', async () => {
    const held = Promise.withResolvers<unknown>();
    let now = 1000,
      calls = 0;
    const o = TransportObservation.create({
      binding: {
        incarnation: 'c'.repeat(24),
        trackId: 'TR_original',
        generation: 1,
      },
      nowMs: () => now,
      readStats: async () => {
        calls++;
        return held.promise;
      },
    });
    const first = o.read(),
      busy = await o.read();
    held.resolve([row()]);
    await first;
    now = 1100;
    const throttled = await o.read();
    assert({
      given: 'an outstanding request then a poll before 250ms',
      should: 'preserve one outstanding call and a finite admission rate',
      actual: { busy, throttled, calls },
      expected: {
        busy: { kind: 'unknown', reason: 'busy' },
        throttled: { kind: 'unknown', reason: 'throttled' },
        calls: 1,
      },
    });
  });
  test('caller cancellation and stale clocks refuse data', async () => {
    const abort = new AbortController();
    abort.abort();
    const s = setup([[row()]]);
    const pre = await s.observer.read(abort.signal);
    s.at(Number.NaN);
    const invalid = await s.observer.read();
    assert({
      given: 'pre-cancelled work and a nonfinite clock',
      should: 'refuse before touching native resources',
      actual: { pre, invalid, calls: s.calls() },
      expected: {
        pre: { kind: 'unknown', reason: 'cancelled' },
        invalid: { kind: 'unknown', reason: 'clock' },
        calls: 0,
      },
    });
  });
});
