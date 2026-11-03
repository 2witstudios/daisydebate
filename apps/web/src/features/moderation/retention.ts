/**
 * How long an erased account's sanctions are kept. A proposed value awaiting
 * counsel (DEC-298, COMP-4); this one line changes it, with no migration.
 */
export const MODERATION_RECORD_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
