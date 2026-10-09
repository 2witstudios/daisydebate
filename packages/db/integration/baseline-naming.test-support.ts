/** ADR0036 names the tombstoned user reference explicitly; no other privacy FK exception. */
export function foreignKeyNameValid({
  col,
  target,
}: {
  readonly col: string;
  readonly target: string;
}): boolean {
  if (col === 'privacy_jobs.subject_ref' && target === 'users') return true;
  const suffix: Record<string, string> = {
    actors: 'actor_id',
    users: 'user_id',
    formats: 'format_id',
    rounds: 'round_id',
    seasons: 'season_id',
  };
  const expected = suffix[target];
  return expected === undefined || (col.split('.')[1] ?? '').endsWith(expected);
}
