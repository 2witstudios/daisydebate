import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  reportingTeardown,
  runEveryStep,
} from '../e2e/support/journey-teardown';
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

test('a failed teardown step does not skip the steps after it', async () => {
  const ran: string[] = [];
  const failure = await runEveryStep([
    async () => {
      ran.push('contexts');
      throw new Error('context.close');
    },
    async () => {
      ran.push('data');
      throw new Error('data.close');
    },
    async () => {
      ran.push('accounts');
    },
  ]).catch((error: AggregateError) => error.message);
  assert({
    given: 'two failing teardown steps before a last one',
    should: 'run all three and report both failures',
    actual: { ran, failure },
    expected: {
      ran: ['contexts', 'data', 'accounts'],
      failure: 'Teardown failed: Error: context.close; Error: data.close',
    },
  });
});
