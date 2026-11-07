import type { BillingPaymentObservation } from '@daisy/protocol/billing';

/** A contradiction stays owed even when traversal moves past its retained identity. */
export const hasObservationConflict = (row: BillingPaymentObservation) =>
  row.state.kind === 'owed' && row.state.reason === 'conflicting_evidence';
