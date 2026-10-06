export type PaletteCommand = {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly keywords: readonly string[];
};

type Range = readonly [number, number];

export type RankedCommand = {
  readonly command: PaletteCommand;
  readonly score: number;
  /** [start, endExclusive] ranges of the title that the query matched. */
  readonly matches: readonly Range[];
};

const boundary = /[\s\-·/_]/;

/** Greedy, case-insensitive subsequence positions of query in text. */
function subsequence(query: string, text: string): readonly number[] | null {
  const haystack = text.toLowerCase();
  const positions: number[] = [];
  let from = 0;
  for (const char of query.toLowerCase()) {
    const at = haystack.indexOf(char, from);
    if (at === -1) return null;
    positions.push(at);
    from = at + 1;
  }
  return positions;
}

function positionScore(text: string, at: number, previous: number | undefined) {
  const prefix = at === 0 ? 5 : 0;
  const wordStart = at > 0 && boundary.test(text.charAt(at - 1)) ? 3 : 0;
  const consecutive = previous !== undefined && at === previous + 1 ? 2 : 0;
  return 1 + prefix + wordStart + consecutive;
}

function scorePositions(text: string, positions: readonly number[]): number {
  return positions.reduce(
    (total, at, i) => total + positionScore(text, at, positions[i - 1]),
    0,
  );
}

function toRanges(positions: readonly number[]): readonly Range[] {
  return positions.reduce<readonly Range[]>((ranges, at) => {
    const last = ranges.at(-1);
    return last !== undefined && last[1] === at
      ? [...ranges.slice(0, -1), [last[0], at + 1]]
      : [...ranges, [at, at + 1]];
  }, []);
}

function keywordScore(
  query: string,
  keywords: readonly string[],
): number | null {
  const scores = keywords.flatMap((keyword) => {
    const positions = subsequence(query, keyword);
    return positions === null ? [] : [scorePositions(keyword, positions)];
  });
  // Keyword hits rank below any title hit of the same quality.
  return scores.length === 0 ? null : Math.max(...scores) / 2;
}

export function scoreCommand(
  query: string,
  command: PaletteCommand,
): RankedCommand | null {
  const trimmed = query.trim();
  if (trimmed === '') return { command, score: 0, matches: [] };
  const positions = subsequence(trimmed, command.title);
  if (positions !== null)
    return {
      command,
      score: scorePositions(command.title, positions),
      matches: toRanges(positions),
    };
  const score = keywordScore(trimmed, command.keywords);
  return score === null ? null : { command, score, matches: [] };
}

export function rankCommands(
  query: string,
  commands: readonly PaletteCommand[],
): readonly RankedCommand[] {
  const ranked = commands.flatMap((command, index) => {
    const result = scoreCommand(query, command);
    return result === null ? [] : [{ result, index }];
  });
  return ranked
    .sort((a, b) => b.result.score - a.result.score || a.index - b.index)
    .map(({ result }) => result);
}

type RankedGroup = {
  readonly group: string;
  readonly items: readonly RankedCommand[];
};

export function groupRanked(
  ranked: readonly RankedCommand[],
): readonly RankedGroup[] {
  const groups = [...new Set(ranked.map((r) => r.command.group))];
  return groups.map((group) => ({
    group,
    items: ranked.filter((r) => r.command.group === group),
  }));
}

export function moveSelection(
  index: number,
  delta: number,
  length: number,
): number {
  if (length <= 0) return 0;
  return (((index + delta) % length) + length) % length;
}
