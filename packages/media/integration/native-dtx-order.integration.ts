import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { observeDtxOrder } from './native-dtx-order.test-support';
import { captureDtxFailures } from './native-dtx-order-failures.test-support';
import { readDtxOutput } from './native-dtx-order-output.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('DEC416 native publication order is acquired once per fresh process, serially', async () => {
  const exits: (number | null)[] = [];
  for (const arm of ['true-first', 'false-closed-then-true']) {
    const child = Bun.spawn(
      [
        process.execPath,
        `${import.meta.dir}/native-dtx-order-arm.test-support.ts`,
        arm,
      ],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      },
    );
    // Drain while running; each arm closes before the next process is created.
    const output = await readDtxOutput(child.stdout, child.stderr);
    exits.push(await child.exited);
    for (const line of output.lines) process.stdout.write(line + '\n');
    process.stdout.write(
      JSON.stringify({
        event: 'native.capture.dtxOrder.process',
        arm,
        exitCode: child.exitCode,
        signalCode: child.signalCode,
        stderrBytes: output.stderrBytes,
        ignoredStdoutLines: output.ignoredStdoutLines,
      }) + '\n',
    );
  }
  assert({
    given:
      'true-first and false-closed-then-true in separate fresh SDK processes',
    should:
      'complete each single acquisition with original input/oracles and measured provenance',
    actual: exits,
    expected: [0, 0],
  });
}, 100000);

test('publication order waits for the false publication cleanup', async () => {
  const falseStarted = Promise.withResolvers<void>();
  const closeFalse = Promise.withResolvers<void>();
  let falseClosed = false;
  let trueStarted = false;
  const observation = observeDtxOrder('false-closed-then-true', async (dtx) => {
    if (dtx) {
      trueStarted = true;
      return { dtx, falseClosed };
    }
    falseStarted.resolve();
    await closeFalse.promise;
    falseClosed = true;
    return { dtx, falseClosed };
  });
  await falseStarted.promise;
  const beforeClose = trueStarted;
  closeFalse.resolve();
  const results = await observation;
  assert({
    given: 'a false publication whose owned cleanup is held',
    should:
      'observe no true publication until cleanup completes and preserve serial observations',
    actual: { beforeClose, results },
    expected: {
      beforeClose: false,
      results: [
        { dtx: false, falseClosed: true },
        { dtx: true, falseClosed: true },
      ],
    },
  });
});

test('a failed preceding publication cannot be silently replaced by a true-only arm', async () => {
  let trueStarted = false;
  const failure = new Error('controlled false publication cleanup failure');
  const outcome = await observeDtxOrder(
    'false-closed-then-true',
    async (dtx) => {
      if (dtx) {
        trueStarted = true;
        return 'unexpected';
      }
      throw failure;
    },
  ).catch((error: unknown) => error);
  assert({
    given: 'the preceding false publication cleanup fails',
    should: 'report that exact failure without acquiring the true publication',
    actual: { sameFailure: outcome === failure, trueStarted },
    expected: { sameFailure: true, trueStarted: false },
  });
});

test('all diagnostic failure stages are contained without forwarding raw causes', async () => {
  const stages: string[] = [];
  const raw = new Error('synthetic-private-loader-or-disposal-cause');
  const accepted = await captureDtxFailures({
    acquire: async () => {
      throw raw;
    },
    dispose: async () => {
      throw raw;
    },
    resources: async () => {
      throw raw;
    },
    report: (stage) => stages.push(stage),
  });
  assert({
    given:
      'bootstrap, disposal and resource reads all fail with private causes',
    should:
      'observe all three failures, retain failure status and let no cause escape',
    actual: { accepted, stages },
    expected: { accepted: false, stages: ['acquire', 'dispose', 'resources'] },
  });
});

test('child stderr and incidental stdout are measured without being forwarded', async () => {
  const raw = 'synthetic-private-stack';
  const event =
    '{"event":"native.capture.dtxOrder.failure","stage":"bootstrap","category":"failed"}';
  const stream = (s: string) => new Blob([s]).stream();
  const observed = await readDtxOutput(
    stream(`${raw}\n${event}\n`),
    stream(raw),
  );
  assert({
    given:
      'a recognized diagnostic event beside raw loader output on both pipes',
    should:
      'forward only the event and count discarded output without any private bytes',
    actual: observed,
    expected: {
      lines: [event],
      stderrBytes: new TextEncoder().encode(raw).length,
      ignoredStdoutLines: 1,
    },
  });
});

test('successful diagnostic acquisition still requires successful disposal and resource reporting', async () => {
  const visited: string[] = [];
  const failures: string[] = [];
  const accepted = await captureDtxFailures({
    acquire: async () => {
      visited.push('acquire');
    },
    dispose: async () => {
      visited.push('dispose');
    },
    resources: async () => {
      visited.push('resources');
    },
    report: (stage) => failures.push(stage),
  });
  assert({
    given: 'all three owned stages complete',
    should: 'accept once with no fabricated failure',
    actual: { accepted, visited, failures },
    expected: {
      accepted: true,
      visited: ['acquire', 'dispose', 'resources'],
      failures: [],
    },
  });
});
