/**
 * The capacity-refusal identity, without the database. It imports only
 * `@daisy/errors`, so modules a client bundle can reach (shared form
 * parsing through `apps/web/src/server/http.ts`) may classify a refusal
 * without loading the driver or schema.
 */
export {
  isReportedCapacityRefusal,
  isTransactionCapacityRefusal,
  markCapacityRefusalReported,
} from './transaction-admission';
