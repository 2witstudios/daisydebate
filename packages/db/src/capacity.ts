/**
 * A lane's capacity refusal (ADR 0088), as callers outside the package
 * classify and report it; the lanes raise it.
 */
export {
  capacityRefusalFields,
  reportCapacityHolders,
  isReportedCapacityRefusal,
  isCapacityRefusal,
  isTemporaryRefusal,
} from './workload';
