/**
 * The address a sample action leads to: the page the viewer is on, with its
 * own query kept and `did=<label>` added. The shell banner reads `did` and
 * says what happened. Nothing is saved: a mock has no backend, so a control
 * with no real operation answers on the same page instead of staying dead.
 */
export const sampleActionHref = (
  pathname: string,
  search: string,
  label: string,
): string => {
  const params = new URLSearchParams(search);
  params.set('did', label);
  return `${pathname}?${params.toString()}`;
};

/** The same page with the banner dismissed: `did` removed, the rest kept. */
export const dismissedHref = (pathname: string, search: string): string => {
  const params = new URLSearchParams(search);
  params.delete('did');
  const rest = params.toString();
  return rest === '' ? pathname : `${pathname}?${rest}`;
};

/** What the banner says for a label read from the (untrusted) query. */
export const sampleActionMessage = (label: string | null): string | null => {
  const clean = label?.trim().slice(0, 80) ?? '';
  return clean === ''
    ? null
    : `${clean}: done on sample data. Nothing was saved or sent.`;
};
