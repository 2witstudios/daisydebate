import {
  captureAdmission,
  type CaptureAdmissionPolicy,
} from '@daisy/protocol/capture-admission';
import { createAppError, createRefusal } from '@daisy/errors';

/** Explicit integration-only refusal adapter; all eligibility is the same portable rule. */
export const captureAdmissionPolicy: CaptureAdmissionPolicy = {
  closed: captureAdmission.closed,
  sessionAdmits: captureAdmission.sessionAdmits,
  requireWindow: (...args) => {
    if (!captureAdmission.windowAdmits(...args))
      throw createAppError('CONFLICT', 'Capture window is ineligible');
  },
  requireObservation: (...args) => {
    const window = captureAdmission.observationWindow(...args);
    if (window === null)
      throw createAppError(
        'CONFLICT',
        'Observation is outside capture authority',
      );
    return window;
  },
  requireSeal: (...args) => {
    if (!captureAdmission.sealTimelineAdmits(...args))
      throw createRefusal(
        'CONFLICT',
        'timeline-open',
        'Capture timeline is still open',
      );
  },
  requireAppendReceipt: (...args) => {
    if (!captureAdmission.receiptAdmits(...args))
      throw createAppError('CONFLICT', 'Capture window is in the future');
  },
  requireObservationReceipt: (...args) => {
    if (!captureAdmission.receiptAdmits(...args))
      throw createAppError('CONFLICT', 'Capture observation is in the future');
  },
};
