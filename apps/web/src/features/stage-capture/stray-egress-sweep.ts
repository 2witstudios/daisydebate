export type StrayEgressEvent =
  'stage.stray_egress_stopped' | 'stage.stray_sweep_failed';

/** One capture's side of the question, whichever feature owns that capture. */
export type StageCaptureOwner = {
  /** Null means this owner has no such capture: leave the Egress alone. */
  readonly recordedEgress: (
    captureId: string,
  ) => Promise<{ readonly egressId: string | null } | null>;
  /** True while no start can be in flight: a start holds this claim across its call. */
  readonly claim: (captureId: string) => Promise<boolean>;
};

/**
 * Stops any running stage Egress its capture did not record: what a crash between
 * a start and its record leaves, or a stop that failed. LiveKit's own list is the
 * only place one can be found. It writes no media, because its credential was never
 * stored and the stage refuses it, but it holds an Egress slot until stopped.
 */
export const createStrayEgressSweep =
  (deps: {
    readonly listStages: () => Promise<
      readonly { readonly egressId: string; readonly captureId: string }[]
    >;
    readonly stop: (egressId: string) => Promise<void>;
    readonly owners: readonly StageCaptureOwner[];
    readonly report: (event: StrayEgressEvent) => void;
  }) =>
  async () => {
    for (const { egressId, captureId } of await deps.listStages())
      try {
        for (const owner of deps.owners) {
          const before = await owner.recordedEgress(captureId);
          if (before === null) continue;
          if (before.egressId === egressId) break;
          if (!(await owner.claim(captureId))) break;
          // Read again under the claim: a start may have recorded it just now.
          const after = await owner.recordedEgress(captureId);
          if (after?.egressId === egressId) break;
          await deps.stop(egressId);
          deps.report('stage.stray_egress_stopped');
          break;
        }
      } catch {
        deps.report('stage.stray_sweep_failed');
      }
  };
