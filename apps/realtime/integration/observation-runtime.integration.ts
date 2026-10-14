import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { observationRuntimeFixture } from './observation-runtime.test-support';
import { waitFor } from './support';

setupRitewayBun();
requireTestServices(process.env);

const texts = (frame: Record<string, unknown> | undefined) =>
  (
    (frame?.body as { messages?: { text?: string }[] } | undefined)?.messages ??
    []
  ).map((message) => message.text ?? null);

test('native observers share one projection and receive committed content without HTTP', async () => {
  const fixture = await observationRuntimeFixture();
  try {
    await fixture.post('first');
    const first = await fixture.connect(),
      second = await fixture.connect();
    first.observe('channel-a');
    second.observe('channel-b');
    await waitFor(
      () => first.snapshots().length > 0 && second.snapshots().length > 0,
      8000,
    );
    const baseline = {
      first: texts(first.snapshots().at(-1)),
      second: texts(second.snapshots().at(-1)),
      ready: first.frames.find((frame) => frame.type === 'observation.ready')
        ?.validForMs,
    };
    await fixture.post('second');
    await waitFor(
      () =>
        texts(first.snapshots().at(-1)).length === 2 &&
        texts(second.snapshots().at(-1)).length === 2,
      8000,
    );
    assert({
      given:
        'two native sockets observing one DM through restricted realtime/projection roles',
      should:
        'deliver a shared baseline, then the later commit as a newer snapshot without a browser request',
      actual: {
        baseline: { first: baseline.first, second: baseline.second },
        validity: Number(baseline.ready) > 0 && Number(baseline.ready) <= 4700,
        latest: texts(first.snapshots().at(-1)),
      },
      expected: {
        baseline: { first: ['first'], second: ['first'] },
        validity: true,
        latest: ['second', 'first'],
      },
    });
    first.close();
    second.close();
  } finally {
    await fixture.close();
  }
}, 20_000);
