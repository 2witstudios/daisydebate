import type { BreakLine } from '../shapes/settings';
import { compareRational, rational } from '../standings/rational';
import type { Seeded } from './seeding';

const atLeast = (s: Seeded, wins: number) =>
  compareRational(s.wins, rational(wins)) >= 0;

/**
 * Who clears a break line, in seed order.
 * - fixed: the top `size`.
 * - record: everyone on at least `wins`.
 * - record_capped: at least `wins`, at most `cap`; when fewer than `floor`
 *   qualify, the next entries in seed order fill up to `floor`.
 * - tie_inclusive: the top `size`, and the run of later entries still tied
 *   with the `size`-th in the seed order, unless that run would pass
 *   `ceiling`.
 */
export const clearLine = (
  ordered: readonly Seeded[],
  line: BreakLine,
): readonly Seeded[] => {
  switch (line.kind) {
    case 'fixed':
      return ordered.slice(0, line.size);
    case 'record':
      return ordered.filter((s) => atLeast(s, line.wins));
    case 'record_capped': {
      const qualified = new Set(
        ordered.filter((s) => atLeast(s, line.wins)).slice(0, line.cap),
      );
      const fill = ordered
        .filter((s) => !qualified.has(s))
        .slice(0, Math.max(0, line.floor - qualified.size));
      const chosen = new Set([...qualified, ...fill]);
      return ordered.filter((s) => chosen.has(s));
    }
    case 'tie_inclusive': {
      const top = ordered.slice(0, line.size);
      const last = top[top.length - 1];
      if (last === undefined || top.length < line.size) return top;
      const rest = ordered.slice(line.size);
      const run = rest.findIndex((s) => !s.tiedWithAbove);
      const level = run === -1 ? rest : rest.slice(0, run);
      return top.length + level.length <= line.ceiling
        ? [...top, ...level]
        : top;
    }
  }
};
