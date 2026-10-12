import type { ObservationHeader } from '@daisy/protocol';
import { observationTestResource } from '@daisy/protocol/observation-testing';
import { createObservationWorker } from './observation-worker';
import type { ObservationWorkerCache } from './observation-worker-cache';

type WorkerInput = Parameters<typeof createObservationWorker>[0];
/** The first content revision of the shared test resource. */
export const testHeader: ObservationHeader = {
  resource: observationTestResource,
  contentRevision: 1,
  disclosureRevision: 1,
  purgeGeneration: 0,
};
const healthyCache: ObservationWorkerCache = {
  ready: async () => true,
  claim: async () => true,
  prepare: async () => true,
  publish: async () => true,
  drop: async () => true,
  release: async () => {},
};
/** An eligible owner with healthy defaults; tests override only what they vary. */
export const testWorker = (
  overrides: Partial<Omit<WorkerInput, 'cache'>> & {
    readonly cache?: Partial<ObservationWorkerCache>;
  } = {},
) =>
  createObservationWorker({
    eligible: true,
    now: () => 0,
    nextToken: () => 'owner',
    readHeaders: async () => [testHeader],
    build: async (_base, header) => ({ header, body: 'body' }),
    ...overrides,
    cache: { ...healthyCache, ...overrides.cache },
  });
