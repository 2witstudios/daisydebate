export type ArtBox = {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
};

export type BracketArtLines = {
  /** One path per round, earliest first, so each can be faded on its own. */
  readonly rounds: readonly string[];
  /** The last line, from the final join out to the champion. */
  readonly champion: string;
  /** Where the champion's dot sits. */
  readonly dot: { readonly x: number; readonly y: number };
};

const round = (value: number): number => Number(value.toFixed(2));

/**
 * A single-elimination bracket drawn as one tree of lines. Every entrant is a
 * line; each pair of lines meets in a vertical, and the middle of that
 * vertical is where the next round's line begins, so nothing floats free. The
 * last join runs on to the champion. `entrants` must be a power of two.
 */
export function bracketArt(entrants: number, box: ArtBox): BracketArtLines {
  const rounds = Math.log2(entrants);
  const step = (box.right - box.left) / (rounds + 1);
  const pitch = (box.bottom - box.top) / (entrants - 1);
  let ys = Array.from({ length: entrants }, (_, i) => box.top + i * pitch);
  const paths: string[] = [];
  for (let level = 0; level < rounds; level += 1) {
    const from = round(box.left + level * step);
    const join = round(from + step);
    const next: number[] = [];
    let d = '';
    for (let pair = 0; pair < ys.length; pair += 2) {
      const upper = round(ys[pair] as number);
      const lower = round(ys[pair + 1] as number);
      d += `M${from} ${upper}H${join}V${lower}M${from} ${lower}H${join}`;
      next.push((upper + lower) / 2);
    }
    paths.push(d);
    ys = next;
  }
  const join = round(box.left + rounds * step);
  const y = round(ys[0] as number);
  const end = round(join + step);
  return {
    rounds: paths,
    champion: `M${join} ${y}H${end}`,
    dot: { x: end, y },
  };
}
