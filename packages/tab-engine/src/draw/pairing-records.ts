import type { FormatDescriptor } from '../shapes/competition';
import type { EventRequest } from '../shapes/draw';
import type { Metric } from '../shapes/settings';
import { standings } from '../standings';
import { gcd } from '../standings/rational';

const recordMetric = (format: FormatDescriptor): Metric | null =>
  format.outcome === 'winner'
    ? 'wins'
    : 'sides' in format
      ? 'team_points'
      : null;

/** Each entry's record at a cutoff, scaled to integers so equal records are equal. */
export const pairingRecords = (
  request: Omit<EventRequest, 'event' | 'tabRound' | 'existing' | 'stage'>,
  seed: Uint8Array,
  cutoff: number,
) => {
  const metric = recordMetric(request.format);
  const ids = request.entries.map((e) => e.id);
  const label =
    metric === 'wins'
      ? 'Wins'
      : metric === 'team_points'
        ? 'Team points'
        : 'Record';
  if (metric === null || cutoff <= 0)
    return {
      label,
      entries: ids.map((entry) => ({
        entry,
        value: { n: 0, d: 1 },
        scaled: 0,
      })),
    };
  const table = standings({
    ...request,
    settings: {
      ...request.settings,
      'standings.tiebreaks': {
        metrics: [metric],
        minimumGames: null,
        terminal: 'shared',
      },
    },
    cutoff,
    division: null,
    seed,
  } as Parameters<typeof standings>[0]);
  const values = table.rows.map(
    (row) => [row.entry, row.values[0]!.value[0]!] as const,
  );
  const scale = values.reduce((l, [, v]) => (l * v.d) / gcd(l, v.d), 1);
  return {
    label,
    entries: values.map(([entry, value]) => ({
      entry,
      value,
      scaled: (value.n * scale) / value.d,
    })),
  };
};
