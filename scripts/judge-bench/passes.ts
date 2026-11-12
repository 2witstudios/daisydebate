/**
 * First pass against final (ADR 0125): for every Round coherency judging
 * decided, did the final ballot keep the first pass's winner, and how did the
 * scores move? Read from staging by `bun judge:bench passes`.
 */
type Side = 'affirmative' | 'negative';
type Scores = Record<Side, Record<string, number>>;

export type PassRow = {
  readonly roundId: string;
  readonly resolution: string | null;
  readonly first: { readonly winner: Side; readonly scores: Scores } | null;
  readonly firstFailed: boolean;
  readonly final: { readonly winner: Side; readonly scores: Scores };
};

const sides: readonly Side[] = ['affirmative', 'negative'];
const short = (side: Side) => (side === 'affirmative' ? 'AFF' : 'NEG');
const signed = (value: number) =>
  `${value > 0 ? '+' : ''}${Number.isInteger(value) ? value : value.toFixed(2)}`;

/** The comparison as Markdown: one line per Round, then agreement and mean score shifts. */
export function passesReport(rows: readonly PassRow[]): string {
  const compared = rows.filter((row) => row.first);
  const shifts = new Map<string, number[]>();
  const lines = rows.map((row) => {
    const title = `${row.roundId} ${row.resolution ?? ''}`.trim();
    if (!row.first)
      return `- ${title}: first pass ${row.firstFailed ? 'failed' : 'missing'}, final ${short(row.final.winner)}`;
    for (const side of sides)
      for (const [category, score] of Object.entries(row.final.scores[side])) {
        const before = row.first.scores[side][category];
        if (before === undefined) continue;
        shifts.set(category, [...(shifts.get(category) ?? []), score - before]);
      }
    const kept = row.first.winner === row.final.winner;
    return `- ${title}: ${short(row.first.winner)} → ${short(row.final.winner)}${kept ? '' : ' (flipped)'}`;
  });
  const agreed = compared.filter(
    (row) => row.first!.winner === row.final.winner,
  ).length;
  const mean = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const moved = [...shifts]
    .map(([category, values]) => `${category} ${signed(mean(values))}`)
    .join(', ');
  return [
    `# First pass against final: ${rows.length} judged Round(s)`,
    '',
    ...lines,
    '',
    `Winner kept: ${agreed}/${compared.length}.`,
    ...(moved
      ? [`Mean score shift, final minus first, per side: ${moved}.`]
      : []),
  ].join('\n');
}
