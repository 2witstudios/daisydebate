import type { SQL } from 'bun';
import type { Waits } from '@daisy/clock';
import type { BoundedTransaction } from './bounded-transaction';
import type { DatabaseEventSink } from './instrumented';
import type { DatabaseResources } from './resources';
import type { TransactionRunner } from './tx';
import type { Lane, WorkloadLane, WorkloadProfile } from './workload';

/** The opened handles a store composes over; package-private. */
export type OpenedResources = {
  readonly profile: WorkloadProfile;
  readonly waits: Waits;
  readonly eventSink: DatabaseEventSink | undefined;
  /** A lane's admitted handles; an unreserved lane refuses every call. */
  readonly lane: (name: WorkloadLane) => Lane;
  /** The lane's one bounded transaction runner, shared by its stores. */
  readonly bounded: (name: WorkloadLane) => BoundedTransaction;
  /** Room preparation's own runner over half the competitive lane. */
  readonly roomCommands: () => TransactionRunner;
  /** LISTEN and the availability election, outside every lane. */
  readonly dedicated: SQL;
};

const opened = new WeakMap<DatabaseResources, OpenedResources>();

/** Records the handles behind `resources`; only the opener calls it. */
export function registerResources(
  resources: DatabaseResources,
  handles: OpenedResources,
): void {
  opened.set(resources, handles);
}

/** The handles behind `resources`; only stores of this package call it. */
export function resourcesOf(resources: DatabaseResources): OpenedResources {
  const handles = opened.get(resources);
  if (!handles) throw new Error('Database resources were not opened here');
  return handles;
}
