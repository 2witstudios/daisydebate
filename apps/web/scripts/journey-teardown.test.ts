import { assert, setupRitewayBun, test } from 'riteway/bun';
import { reportingTeardown } from '../e2e/support/journey-teardown';
setupRitewayBun();

const journey = (close: () => Promise<void>) => {
  const reported: unknown[] = [];
  return {
    reported,
    close: reportingTeardown(close, (teardown) => reported.push(teardown)),
  };
};

test('a clean teardown reports nothing', async () => {
  const { close, reported } = journey(async () => {});
  await close();
  assert({
    given: 'a teardown that succeeds',
    should: 'report nothing',
    actual: reported,
    expected: [],
  });
});

test('a failed teardown never replaces the primary failure', async () => {
  const primary = new Error('primary assertion');
  const teardown = new Error('context.close');
  const { close, reported } = journey(async () => {
    throw teardown;
  });
  const failure = await (async () => {
    try {
      throw primary;
    } finally {
      await close();
    }
  })().catch((error: unknown) => error);
  assert({
    given: 'a test that failed and a teardown that also failed',
    should: 'keep the primary failure and report the teardown separately',
    actual: { failure, reported },
    expected: { failure: primary, reported: [teardown] },
  });
});
