import type { ObservationBase } from '@daisy/protocol';
import {
  createObservationNode,
  type ObservationSnapshot,
} from './observation-node';
import {
  createObservationPermit,
  observationEvidence,
  type ObservationPermit,
} from './observation-permit';

/** Five-second evidence for one component, started at `started`. */
const testEvidence = (started = 0, fingerprint = 'same') =>
  observationEvidence({
    started,
    remainingMs: 5000,
    fingerprint,
    dependencies: [],
  });
/** Installs identical subject, cohort and entitlement evidence on `permit`. */
export function grant(
  permit: ObservationPermit,
  base: ObservationBase,
  started = 0,
) {
  const part = testEvidence(started);
  return permit.install(permit.begin(), {
    base,
    minimumContentRevision: 1,
    purgeGeneration: 0,
    subject: part,
    cohort: part,
    entitlement: part,
  });
}
/** A node-local permit, granted for `base` unless `granted` is false. */
export function testPermit(
  base: ObservationBase,
  {
    now = () => 0,
    granted = true,
  }: { now?: () => number; granted?: boolean } = {},
) {
  const permit = createObservationPermit({ now, nodeIncarnation: 'node' });
  if (granted) grant(permit, base, now());
  return permit;
}
/** A node whose cache demand is inert and whose reads are scripted. */
export const testNode = ({
  now = () => 0,
  yieldWork = async () => {},
  read = async (): Promise<ObservationSnapshot | null> => null,
}: {
  now?: () => number;
  yieldWork?: () => Promise<void>;
  read?: (base: ObservationBase) => Promise<ObservationSnapshot | null>;
} = {}) =>
  createObservationNode({
    nodeIncarnation: 'node',
    now,
    yieldWork,
    cache: { demand: async () => {}, read },
  });
/** A yield that holds every fanout slice until `resume`. */
export function testBarrier() {
  let resume!: () => void;
  const wait = new Promise<void>((resolve) => {
    resume = resolve;
  });
  return { wait, resume };
}
