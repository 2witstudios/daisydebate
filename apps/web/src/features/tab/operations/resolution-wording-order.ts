import { commandDigest } from './command-digest';
/** A server-minted seed fixes selection once; caller command identity is not entropy. */
export const orderedWordings = <Row extends { readonly id: string }>(
  rows: readonly Row[],
  entropy: string,
  salt: string,
): readonly Row[] =>
  rows
    .map((row) => ({ row, rank: commandDigest({ entropy, salt, id: row.id }) }))
    .sort((a, b) => a.rank.localeCompare(b.rank))
    .map(({ row }) => row);
