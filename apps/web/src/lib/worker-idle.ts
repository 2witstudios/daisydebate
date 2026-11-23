/**
 * Idle caps by urgency (ADR 0154). Live-Round loops are woken where a command
 * creates their work; Room maintenance and housekeeping rely on the cap alone.
 */
export const LIVE_IDLE_MAX_MS = 10_000;
export const HOUSEKEEPING_IDLE_MAX_MS = 60_000;
