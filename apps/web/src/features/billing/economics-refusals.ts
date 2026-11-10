import { createRefusal } from '@daisy/errors';

/**
 * The economics refusals minted in more than one place: one factory each, so a
 * reason word and its code cannot drift apart (ADR 0102).
 */
export const windowInvalid = () =>
  createRefusal(
    'INTERNAL',
    'economics-window-invalid',
    'Billing economics window invalid',
  );

export const clockInvalid = () =>
  createRefusal(
    'INTERNAL',
    'economics-clock-invalid',
    'Billing economics clock invalid',
  );

export const sinkFull = () =>
  createRefusal(
    'INFRASTRUCTURE',
    'economics-sink-full',
    'Billing economics directory capacity exceeded',
  );
