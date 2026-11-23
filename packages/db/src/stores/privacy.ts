import { instrumented } from '../instrumented';
import {
  deliverObservationPurges,
  owedObservationPurges,
} from '../observation-purge-jobs';
import type { PrivacySubject } from '../privacy/contracts';
import type { PrivacyVerificationBinding } from '../privacy/operations';
import {
  eraseGuardianChild,
  erasePrivacySubject,
  exportPrivacySubject,
} from '../privacy/subject-rights';
import {
  deliverPrivacyJob,
  duePrivacyJobs,
  owedPrivacyJobs,
} from '../privacy/vendor-jobs';
import type { RoomClosureTransitions } from '../room-account-closure';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/**
 * Subject rights (ADR 0087) and the vendor and observation purge jobs, on
 * the control lane. Erasure closes the account and keeps the competitive
 * record; export reads it under one lock. The caller supplies the engine's
 * Room transitions and, for erasure, the verification bindings.
 */
export const createPrivacyStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  return namedLaneOperations({
    /** ISSUE-852: due observation purge jobs, delivered with one confirmed cache purge. */
    deliverObservationPurges: (
      input: Parameters<typeof deliverObservationPurges>[1],
      port: Parameters<typeof deliverObservationPurges>[2],
    ) =>
      instrumented(eventSink, 'deliverObservationPurges', () =>
        deliverObservationPurges(control, input, port),
      ),
    owedObservationPurges: () =>
      instrumented(eventSink, 'owedObservationPurges', () =>
        owedObservationPurges(control),
      ),
    owedPrivacyJobs: (input?: Parameters<typeof owedPrivacyJobs>[1]) =>
      instrumented(eventSink, 'owedPrivacyJobs', () =>
        owedPrivacyJobs(control, input),
      ),
    /** ISSUE-833: due vendor deletion jobs, read for the scheduled worker. */
    duePrivacyJobs: (input: Parameters<typeof duePrivacyJobs>[1]) =>
      instrumented(eventSink, 'duePrivacyJobs', () =>
        duePrivacyJobs(control, input),
      ),
    /** ISSUE-833: one job claimed, delivered through its port and recorded. */
    deliverPrivacyJob: (
      input: Parameters<typeof deliverPrivacyJob>[1],
      port: Parameters<typeof deliverPrivacyJob>[2],
    ) =>
      instrumented(eventSink, 'deliverPrivacyJob', () =>
        deliverPrivacyJob(control, input, port),
      ),
    erasePrivacySubject: (
      input: Parameters<typeof erasePrivacySubject>[1],
      rooms: RoomClosureTransitions,
      verificationBindings: readonly PrivacyVerificationBinding[],
    ) =>
      instrumented(eventSink, 'erasePrivacySubject', () =>
        erasePrivacySubject(control, input, rooms, verificationBindings),
      ),
    eraseGuardianChild: (
      input: Parameters<typeof eraseGuardianChild>[1],
      rooms: RoomClosureTransitions,
      verificationBindings: readonly PrivacyVerificationBinding[],
    ) =>
      instrumented(eventSink, 'eraseGuardianChild', () =>
        eraseGuardianChild(control, input, rooms, verificationBindings),
      ),
    exportPrivacySubject: (
      subject: PrivacySubject,
      rooms: RoomClosureTransitions,
    ) =>
      instrumented(eventSink, 'exportPrivacySubject', () =>
        exportPrivacySubject(control, subject, rooms),
      ),
  });
};
export type PrivacyStore = ReturnType<typeof createPrivacyStore>;
