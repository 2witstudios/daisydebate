import {
  ENVELOPE_VERSION,
  type ObservationServerMessage,
} from '@daisy/protocol';
import {
  observationTestBase,
  observationTestResource,
} from '@daisy/protocol/observation-testing';
import type { Scheduler } from './connection-types';

type Frame<T extends ObservationServerMessage['type']> = Extract<
  ObservationServerMessage,
  { type: T }
>;
/** A string-bodied descriptor over the shared test channel. */
export const testDescriptor = {
  resource: observationTestResource,
  window: { after: null, limit: 50 },
  schema: 'channel-v1',
  decode: (body: unknown) => (typeof body === 'string' ? body : null),
} as const;
const testBase = observationTestBase();
export const readyFrame = (
  overrides: Partial<Frame<'observation.ready'>> = {},
): Frame<'observation.ready'> => ({
  v: ENVELOPE_VERSION,
  type: 'observation.ready',
  id: 'id',
  generation: 1,
  base: testBase,
  minimumContentRevision: 1,
  validForMs: 4900,
  overlay: null,
  ...overrides,
});
export const snapshotFrame = (
  overrides: Partial<Frame<'observation.snapshot'>> = {},
): Frame<'observation.snapshot'> => ({
  v: ENVELOPE_VERSION,
  type: 'observation.snapshot',
  id: 'id',
  generation: 1,
  base: testBase,
  contentRevision: 1,
  purgeGeneration: 0,
  body: 'shared',
  ...overrides,
});
/** A scheduler whose timers run only when a test fires them. */
export function testTimers(now: () => number = () => 0) {
  const timers = new Map<number, () => void>();
  let next = 0;
  const scheduler: Scheduler = {
    now,
    setTimeout: (callback) => {
      timers.set(++next, callback);
      return next;
    },
    clearTimeout: (id) => {
      timers.delete(id as number);
    },
  };
  return {
    scheduler,
    timers,
    fire: () => {
      for (const callback of [...timers.values()]) callback();
    },
  };
}
