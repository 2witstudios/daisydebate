import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import { mediaCaptureOperations } from '../media-capture';
import { NecessaryEvidenceRetirement } from '../necessary-evidence-retirement/necessary-evidence-retirement';
import { TranscriptionRecovery } from '../transcription-recovery/transcription-recovery';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/**
 * Media capture's leased ingress, transcription recovery and necessary
 * evidence retirement, each made with its feature's own policy, on the
 * competitive lane's bounded transaction.
 */
export const createMediaCaptureStore = (
  resources: DatabaseResources,
  options: {
    readonly decisionRelease?: DecisionReleasePolicy | undefined;
  } = {},
) => {
  const run = resourcesOf(resources).bounded('competitive');
  return namedLaneOperations({
    createTranscriptionRecovery: (
      recovery: Omit<Parameters<typeof TranscriptionRecovery.create>[0], 'run'>,
    ) => TranscriptionRecovery.create({ ...recovery, run }),
    createNecessaryEvidenceRetirement: (
      retirement: Omit<
        Parameters<typeof NecessaryEvidenceRetirement.create>[0],
        'run'
      >,
    ) => NecessaryEvidenceRetirement.create({ ...retirement, run }),
    createMediaCaptureOperations: (
      input: Omit<Parameters<typeof mediaCaptureOperations>[0], 'run'>,
    ) =>
      namedLaneOperations(
        mediaCaptureOperations({
          ...input,
          decisionRelease: options.decisionRelease,
          run,
        }),
      ),
  });
};
export type MediaCaptureStore = ReturnType<typeof createMediaCaptureStore>;
