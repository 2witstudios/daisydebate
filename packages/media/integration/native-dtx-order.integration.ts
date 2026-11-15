import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { observeDtxOrder } from './native-dtx-order.test-support';
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
        stderr: 'inherit',
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      },
    );
    // Drain while running; each arm closes before the next process is created.
    const output = await new Response(child.stdout).text();
    exits.push(await child.exited);
    process.stdout.write(output);
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
