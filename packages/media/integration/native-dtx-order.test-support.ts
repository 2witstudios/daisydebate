/** Each observation owns publication cleanup before the next can start. */
export async function observeDtxOrder<Result>(
  arm: 'true-first' | 'false-closed-then-true',
  observe: (requestedDtx: boolean) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  for (const requestedDtx of arm === 'true-first' ? [true] : [false, true])
    results.push(await observe(requestedDtx));
  return results;
}
