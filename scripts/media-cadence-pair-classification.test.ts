import { assert, setupRitewayBun, test } from 'riteway/bun';
import { classifyCadencePair } from './media-cadence-pair.test-support';
setupRitewayBun();

test('a paired control failure never becomes a product cadence pass', () => {
  assert({
    given:
      'control failure, writer-only delay, no reproduced failure, or invalid samples',
    should:
      'retain the strict60ms boundary and classify evidence without claiming product PASS',
    actual: [
      classifyCadencePair({
        writerOnTime: true,
        controlOnTime: true,
        writerMaxGapMs: 10,
        controlMaxGapMs: 60,
      }),
      classifyCadencePair({
        writerOnTime: true,
        controlOnTime: true,
        writerMaxGapMs: 60,
        controlMaxGapMs: 10,
      }),
      classifyCadencePair({
        writerOnTime: true,
        controlOnTime: true,
        writerMaxGapMs: 59.9,
        controlMaxGapMs: 59.9,
      }),
      classifyCadencePair({
        writerOnTime: true,
        controlOnTime: false,
        writerMaxGapMs: 10,
        controlMaxGapMs: 10,
      }),
      classifyCadencePair({
        writerOnTime: false,
        controlOnTime: true,
        writerMaxGapMs: 10,
        controlMaxGapMs: 10,
      }),
      classifyCadencePair({
        writerOnTime: true,
        controlOnTime: true,
        writerMaxGapMs: NaN,
        controlMaxGapMs: 10,
      }),
    ],
    expected: [
      'environmental-or-inconclusive',
      'writer-delay-not-explained-by-control',
      'no-failure-observed',
      'environmental-or-inconclusive',
      'writer-delay-not-explained-by-control',
      'inconclusive',
    ],
  });
});

test('collector accepts ArrayBuffer source input before any timer acquisition', async () => {
  const { cadenceSourceDigest } =
    await import('./media-cadence-pair.test-support');
  assert({
    given: 'the ArrayBuffer returned by Bun.file.arrayBuffer, containing abc',
    should: 'hash the bytes through an accepted typed view',
    actual: cadenceSourceDigest(new Uint8Array([97, 98, 99]).buffer),
    expected:
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  });
});

test('collector preserves a failed child diagnostic and malformed output without running timers', async () => {
  const { captureCadenceObserver } =
    await import('./media-cadence-pair.test-support');
  const failed = await captureCadenceObserver([
    process.execPath,
    '-e',
    "process.stderr.write('fixture diagnostic'); process.exit(1)",
  ]);
  const malformed = await captureCadenceObserver([
    process.execPath,
    '-e',
    "process.stdout.write('not JSON')",
  ]);
  assert({
    given:
      'a process exit with diagnostic text and an exit-zero process with invalid JSON',
    should:
      'join both and retain the actual diagnostic or parsing refusal, with no observation fabricated',
    actual: {
      failed: {
        exitCode: failed.exitCode,
        joined: failed.joined,
        error: failed.stderr.text,
        observation: failed.observation,
      },
      malformed: {
        joined: malformed.joined,
        output: malformed.stdout.text,
        parseError: malformed.parseError,
        observation: malformed.observation,
      },
    },
    expected: {
      failed: {
        exitCode: 1,
        joined: true,
        error: 'fixture diagnostic',
        observation: null,
      },
      malformed: {
        joined: true,
        output: 'not JSON',
        parseError: 'observer-output-not-json',
        observation: null,
      },
    },
  });
});

test('observation schema rejects changed criteria, inconsistent gaps and a different source head', async () => {
  const { decodeCadenceObservation, cadenceSourceDigest } =
    await import('./media-cadence-pair.test-support');
  const stamps = Array.from({ length: 30 }, (_, index) => index * 10);
  const context = {
    freeMemory: 0,
    totalMemory: 0,
    loadAverage: [0, 0, 0],
    usage: {},
  };
  const fixture = {
    event: 'media.cadencePairedControl',
    sourceHead: 'a'.repeat(40),
    sourceBlob: 'b'.repeat(64),
    bunVersion: 'fixture',
    platform: 'fixture',
    architecture: 'fixture',
    input: {
      frames: 30,
      samplesPerFrame: 240,
      sampleRate: 24000,
      channels: 1,
      leadMs: 0,
      queuedMs: 0,
      pcmSha256: cadenceSourceDigest(new Uint8Array(14400).buffer),
    },
    thresholdMs: 60,
    writerStarted: 0,
    writerStamps: stamps,
    controlStamps: stamps,
    waits: stamps.map((due) => ({
      caller: 'control',
      due,
      entered: due,
      resumed: due,
    })),
    gaps: { writerMaxGapMs: 10, controlMaxGapMs: 10 },
    writerBefore190: 19,
    controlBefore190: 19,
    result: {
      sentSamples: 7200,
      playedSamples: 7200,
      aborted: false,
      cut: false,
    },
    concurrentResolved: true,
    classification: 'no-failure-observed',
    pressureBefore: context,
    pressureAfter: context,
    elapsedMs: 300,
    limitation:
      'one paired JS-timer fixture; no native audio, no attribution to GC/CPU/host, no product PASS or waiver, publication setTimeout is not measured',
  };
  const refused = (value: unknown) => {
    try {
      decodeCadenceObservation(JSON.stringify(value), 'a'.repeat(40));
      return false;
    } catch {
      return true;
    }
  };
  assert({
    given:
      'synthetic schema data followed by a changed SLA, misreported gap, classifier or provenance',
    should:
      'accept only the coherent original protocol without acquiring any timers',
    actual: [
      refused(fixture),
      refused({ ...fixture, thresholdMs: 100 }),
      refused({ ...fixture, gaps: { writerMaxGapMs: 1, controlMaxGapMs: 10 } }),
      refused({ ...fixture, classification: 'environmental-or-inconclusive' }),
      refused({ ...fixture, sourceHead: 'c'.repeat(40) }),
    ],
    expected: [false, true, true, true, true],
  });
});

test('collector suppresses credential lines and private paths while retaining an error and fingerprint', async () => {
  const { captureCadenceObserver } =
    await import('./media-cadence-pair.test-support');
  const message =
    'TypeError: fixture failure\nAuthorization: Bearer tiny-secret\nGH_TOKEN=short-secret\nHTTP403 https://user:secret@example.invalid/path?token=query\n/home/alice/private/file';
  const result = await captureCadenceObserver([
    process.execPath,
    '-e',
    `process.stderr.write(${JSON.stringify(message)});process.exit(1)`,
  ]);
  assert({
    given:
      'a deliberately failed child with actionable error context plus short credentials and private paths',
    should:
      'retain bounded sanitized context and the raw fingerprint without forwarding private values',
    actual: {
      joined: result.joined,
      actionable:
        result.stderr.text.includes('TypeError: fixture failure') &&
        result.stderr.text.includes('HTTP403 <url>'),
      private: [
        'tiny-secret',
        'short-secret',
        'query',
        '/home/alice',
        'user:secret',
      ].some((value) => result.stderr.text.includes(value)),
      fingerprint: /^[a-f0-9]{64}$/.test(result.stderr.sha256),
    },
    expected: {
      joined: true,
      actionable: true,
      private: false,
      fingerprint: true,
    },
  });
});

test('collector joins an over-limit child and refuses truncated evidence', async () => {
  const { captureCadenceObserver } =
    await import('./media-cadence-pair.test-support');
  const result = await captureCadenceObserver([
    process.execPath,
    '-e',
    "process.stdout.write('x'.repeat(70000))",
  ]);
  assert({
    given: 'a synthetic output larger than the 64KiB evidence allowance',
    should: 'join the child, mark truncation and produce no observation',
    actual: {
      joined: result.joined,
      truncated: result.stdout.truncated,
      bounded: result.stdout.text.length <= 65536,
      observation: result.observation,
    },
    expected: {
      joined: true,
      truncated: true,
      bounded: true,
      observation: null,
    },
  });
});
