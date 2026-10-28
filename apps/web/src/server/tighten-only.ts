import { createAppError } from '@daisy/errors';

/**
 * A DEC-251 policy override may only tighten its floor: each check returns
 * the floor when absent, the value when tighter, and refuses a looser value
 * by naming `<prefix>.<field>`, never clamping it.
 */
export const tightenOnly = (prefix: string) => {
  const refuse = (field: string): never => {
    throw createAppError(
      'VALIDATION',
      `${prefix}.${field} would loosen DEC-251`,
    );
  };
  return {
    refuse,
    atMost: (field: string, floor: number, value: number | undefined) =>
      value === undefined ? floor : value <= floor ? value : refuse(field),
    atLeast: (field: string, floor: number, value: number | undefined) =>
      value === undefined ? floor : value >= floor ? value : refuse(field),
  };
};
