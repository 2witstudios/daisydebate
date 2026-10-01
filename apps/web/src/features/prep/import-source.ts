import { getCard } from './get-card';

/** What happened when a link was given to the importer. */
export type ImportOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'fetched';
      readonly title: string;
      readonly author: string;
      readonly published: string;
      readonly words: number;
    }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'login-wall'; readonly words: number }
  | { readonly kind: 'scan-pdf' }
  | {
      readonly kind: 'duplicate';
      readonly cardId: string;
      readonly cardTitle: string;
      readonly savedOn: string;
    };

const isLink = (value: string): boolean => /^https?:\/\/\S+$/i.test(value);

/**
 * The importer's one seam. It fetches a link and classifies the answer. There
 * is no server fetch yet, so the mock reads the address itself: a link with
 * "unreachable" does not open, "login" sits behind a sign-in, a ".pdf" with
 * "scan" has no text, the address of a saved card is a duplicate, and any
 * other link comes back fetched. The real (server-side, SSRF-safe) fetch
 * replaces this function and nothing else.
 */
export function importSource(url: string): ImportOutcome {
  if (url === '') return { kind: 'idle' };
  if (!isLink(url)) return { kind: 'invalid' };
  const lower = url.toLowerCase();
  if (lower.includes('unreachable')) return { kind: 'unreachable' };
  if (lower.includes('login')) return { kind: 'login-wall', words: 120 };
  if (lower.includes('scan') && lower.endsWith('.pdf'))
    return { kind: 'scan-pdf' };
  const saved = getCard('cost-estimates');
  if (saved !== undefined && url === saved.url)
    return {
      kind: 'duplicate',
      cardId: saved.id,
      cardTitle: saved.tagLine,
      savedOn: saved.retrieved,
    };
  return {
    kind: 'fetched',
    title: '[Title of the source]',
    author: '[Author A]',
    published: '[yyyy-mm-dd]',
    words: 1204,
  };
}
