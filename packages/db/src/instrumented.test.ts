import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { instrumented } from './instrumented';
import {
  createWorkloadExecutor,
  isCapacityRefusal,
} from './workload-admission';

setupRitewayBun();

const recording = () => {
  const events: string[] = [];
  return {
    events,
    sink: (event: string) => {
      events.push(event);
    },
  };
};

test('a lane capacity refusal is reported once, as a refusal, never as a failed query', async () => {
  const { events, sink } = recording();
  const executor = createWorkloadExecutor(
    { control: 0 },
    { onRefused: () => sink('db.capacity.refused') },
  );
  const refusal = await instrumented(sink, 'lookup', () =>
    executor.run('control', async () => 'never'),
  ).catch((error: unknown) => error);
  const wrapped = createAppError('INFRASTRUCTURE', undefined, refusal);
  assert({
    given:
      'an operation whose lane refuses it, and that refusal wrapped by a caller',
    should:
      'log only the capacity refusal and recognise it through the cause chain',
    actual: {
      events,
      refused: isCapacityRefusal(refusal),
      wrapped: isCapacityRefusal(wrapped),
    },
    expected: {
      events: ['db.capacity.refused'],
      refused: true,
      wrapped: true,
    },
  });
});

test('a query that fails for any other reason is still reported as a failed query', async () => {
  const { events, sink } = recording();
  const failure = await instrumented(sink, 'lookup', async () => {
    throw createAppError('INFRASTRUCTURE');
  }).catch((error: unknown) => error);
  assert({
    given: 'an operation that fails without a capacity refusal',
    should: 'log db.query.failed and not call it a refusal',
    actual: { events, refused: isCapacityRefusal(failure) },
    expected: { events: ['db.query.failed'], refused: false },
  });
});
