import type { Prose } from './article';

/** A run of article copy: plain text, or a link to an app path. */
export type ProseRun =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

// A path on this site: one leading slash, never `//`, which leaves it.
const link = /\[([^\]]+)\]\((\/(?!\/)[^)\s]*)\)/g;

/** Splits copy into text and `[label](/path)` links; only local paths link. */
export const proseRuns = (prose: Prose): readonly ProseRun[] => {
  const runs: ProseRun[] = [];
  let last = 0;
  for (const match of prose.matchAll(link)) {
    const [whole, text = '', href = ''] = match;
    if (match.index > last)
      runs.push({ kind: 'text', text: prose.slice(last, match.index) });
    runs.push({ kind: 'link', text, href });
    last = match.index + whole.length;
  }
  if (last < prose.length) runs.push({ kind: 'text', text: prose.slice(last) });
  return runs;
};

/** Every link a piece of copy holds. */
export const proseLinks = (prose: Prose): readonly string[] =>
  proseRuns(prose).flatMap((run) => (run.kind === 'link' ? [run.href] : []));
