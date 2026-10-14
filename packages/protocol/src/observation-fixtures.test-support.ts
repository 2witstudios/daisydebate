import type { ObservationBase } from './observation';

/** One shared channel resource for observation contract tests. */
export const observationTestResource = {
  kind: 'channel',
  id: 'a'.repeat(24),
} as const;
/** The canonical first-page shared base; tests override only what they vary. */
export const observationTestBase = (
  overrides: Partial<ObservationBase> = {},
): ObservationBase => ({
  schema: 1,
  resource: observationTestResource,
  partition: { kind: 'shared', policyKey: 'v1' },
  disclosureRevision: 1,
  window: { after: null, limit: 50 },
  ...overrides,
});
