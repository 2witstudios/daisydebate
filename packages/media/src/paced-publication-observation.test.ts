import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPacedAudioWriter } from './paced-publication';
import { createPublicationObserver } from './publication-observation';
import { assessNativePublicationEvidence } from '../integration/publication-evidence.test-support';

setupRitewayBun();
type Copied = Parameters<Parameters<typeof createPublicationObserver>[0]>[0];
type Mode =
  | 'omitted'
  | 'normal'
  | 'terminal-throw'
  | 'async'
  | 'then-getter'
  | 'mutating'
  | 'reentrant';
type Fault =
  | 'none'
  | 'late-receipt'
  | 'history'
  | 'cancel'
  | 'nonfinite-receipt'
  | 'wake-once'
  | 'wake-twice'
  | 'refresh-reject';

/** Scripted effects test decision equivalence, not native/transport qualification. */
async function run(mode: Mode, fault: Fault = 'none') {
  let now = 1000,
    samples = 0,
    windows = 0,
    waits = 0,
    calibrations = 0;
  const controller = new AbortController();
  const calls: unknown[] = [];
  const records: Copied[] = [];
  const observer = createPublicationObserver((event) => {
    records.push(event);
    if (mode === 'reentrant') observer.observe({} as never);
    if (mode === 'terminal-throw' && event.kind === 'terminal')
      throw new Error('synthetic terminal delivery failure');
    if (mode === 'async')
      return Promise.reject(new Error('synthetic async consumer'));
    if (mode === 'then-getter')
      return {
        get then() {
          throw new Error('synthetic then getter');
        },
      };
    if (mode === 'mutating') (event as { sequence: number }).sequence = 999;
  });
  const write = createPacedAudioWriter({
    publication: {
      capture10ms: async (data: Int16Array) => {
        const beforeMs = now;
        const startSample = samples;
        samples += data.length;
        now += fault === 'late-receipt' && samples === 1440 ? 101 : 1;
        const receipt = {
          startSample,
          endSample: samples,
          beforeMs,
          afterMs: fault === 'nonfinite-receipt' ? Number.NaN : now,
        };
        calls.push(['capture', receipt]);
        return receipt;
      },
      sentSamples: () => {
        calls.push(['source-prefix', samples]);
        return samples;
      },
      close: async () => {
        throw new Error('The caller owns native teardown');
      },
    } as never,
    sampleRate: 48000,
    channels: 1,
    framesPerAuthorization: 1,
    refreshAfterMs: 50,
    nowMs: () => {
      calls.push(['now', now]);
      return now;
    },
    waitUntilMs: async (dueMs) => {
      calls.push(['wait', dueMs]);
      waits++;
      const lateWake =
        fault === 'wake-twice' || (fault === 'wake-once' && waits === 1);
      now = Math.max(now, dueMs) + (lateWake ? 101 : 0);
    },
    calibrate: async () => {
      calibrations++;
      const calibration = {
        sentAtMs: now,
        receivedAtMs: now,
        serverNowMs:
          1_792_000_000_000 +
          now +
          (fault === 'refresh-reject' && calibrations > 1 ? 1000 : 0),
        precisionMs: 1,
      };
      calls.push(['calibrate', calibration]);
      return calibration;
    },
    authorizeWindow: async (window) => {
      windows++;
      now++;
      const allowed = fault !== 'history' || windows !== 4;
      calls.push(['authorize', window, allowed]);
      return allowed;
    },
    onAccepted: (eligible) => {
      calls.push(['accepted', eligible]);
      if (fault === 'cancel' && eligible === 1440) {
        calls.push(['cancel']);
        controller.abort();
      }
    },
    ...(mode === 'omitted' ? {} : { observer }),
  });
  const result = await write(new Int16Array(9600), controller.signal);
  await Promise.resolve();
  return { result, calls, records, delivery: observer.status() };
}

test('actual writer observations identify the rejected receipt rather than infer from stop clock', async () => {
  const observed = await run('normal', 'late-receipt');
  assert({
    given: 'a third native receipt past the original acknowledgement bound',
    should:
      'retain the actual canonical rejection and unchanged partial credit',
    actual: {
      result: observed.result,
      rejections: observed.records.flatMap((r) =>
        r.kind === 'receipt' && r.decision !== 'accepted' ? [r.decision] : [],
      ),
      terminal: observed.records.at(-1)?.kind,
    },
    expected: {
      result: {
        eligibleSamples: 960,
        complete: false,
        segmentEnded: false,
        stop: 'clock',
      },
      rejections: ['receipt.late'],
      terminal: 'terminal',
    },
  });
});

test('omitted normal and failed collectors preserve identical publication authority for identical injected inputs', async () => {
  const faults: Fault[] = ['none', 'late-receipt', 'history', 'cancel'];
  const modes: Mode[] = [
    'normal',
    'terminal-throw',
    'async',
    'then-getter',
    'mutating',
    'reentrant',
  ];
  const equal: boolean[] = [];
  for (const fault of faults) {
    const baseline = await run('omitted', fault);
    for (const mode of modes) {
      const observed = await run(mode, fault);
      equal.push(
        JSON.stringify([baseline.result, baseline.calls]) ===
          JSON.stringify([observed.result, observed.calls]),
      );
    }
  }
  assert({
    given:
      'identical scripted clocks, receipts, history and cancellation with omitted or varied collectors',
    should:
      'keep decisions, source calls, authorization order and public results exactly equal',
    actual: equal,
    expected: Array.from({ length: faults.length * modes.length }, () => true),
  });
});

test('happy publication retains complete real-contract counts while terminal delivery failure stays unusable', async () => {
  const observed = await run('terminal-throw');
  assert({
    given: 'a complete scripted job whose observer stores terminal then throws',
    should:
      'preserve the strict public result and invalidate its diagnostic delivery',
    actual: {
      result: observed.result,
      receipts: observed.records.filter((r) => r.kind === 'receipt').length,
      terminal: observed.records.at(-1)?.kind,
      delivery: observed.delivery.state,
    },
    expected: {
      result: {
        eligibleSamples: 9600,
        complete: true,
        segmentEnded: false,
        stop: null,
      },
      receipts: 20,
      terminal: 'terminal',
      delivery: 'invalid',
    },
  });
});

test('the ordered evidence ledger accepts actual writer records rather than a hand-built count fixture', async () => {
  const cases = [
    ['none', 'complete'],
    ['late-receipt', 'receipt.late'],
    ['history', 'refused'],
    ['cancel', 'cancelled'],
    ['nonfinite-receipt', 'receipt.nonfinite'],
    ['wake-once', 'complete'],
    ['wake-twice', 'stall'],
    ['refresh-reject', 'refresh.offset-ahead'],
  ] as const;
  const assessments = [];
  for (const [fault, expected] of cases) {
    const actual = await run('normal', fault);
    assessments.push(
      assessNativePublicationEvidence(
        {
          events: actual.records,
          delivery: actual.delivery,
        },
        actual.result,
        expected,
      ),
    );
  }
  assert({
    given:
      'actual scripted writer events with refresh and complete, rejected receipt, history refusal or cancellation',
    should:
      'correlate each cadence, contiguous source prefix, actual history window and terminal decision',
    actual: assessments,
    expected: cases.map(([, decision]) => ({
      state: 'confirmed' as const,
      decision,
    })),
  });
});
