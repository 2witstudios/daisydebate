import { createAppError } from '@daisy/errors';
import type { RateRule } from './rate-limit';

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
  const atMost = (field: string, floor: number, value: number | undefined) =>
    value === undefined ? floor : value <= floor ? value : refuse(field);
  return {
    refuse,
    atMost,
    /** The same window lengths, each allowing no more than the floor's. */
    windows: (
      field: string,
      floor: readonly RateRule[],
      value: readonly RateRule[] | undefined,
    ): readonly RateRule[] => {
      if (value === undefined) return floor;
      if (value.length !== floor.length) return refuse(field);
      return floor.map((rule) => {
        const next = value.find(
          (row) => row.windowSeconds === rule.windowSeconds,
        );
        return next
          ? { ...rule, max: atMost(field, rule.max, next.max) }
          : refuse(field);
      });
    },
    atLeast: (field: string, floor: number, value: number | undefined) =>
      value === undefined ? floor : value >= floor ? value : refuse(field),
  };
};
