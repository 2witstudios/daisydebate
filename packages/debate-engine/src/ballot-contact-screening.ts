import type { BallotWrittenRecord } from '@daisy/protocol';

/** Deterministic contact rules only; this does not classify language or intent. */
const contactPatterns = [
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
  /(?:https?:\/\/|www\.)[^\s<>]+|\b(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}]{2,}(?:\/[^\s<>]*)?/giu,
  /(?<![\p{L}\p{N}_])@[\p{L}\p{N}_][\p{L}\p{N}_.-]*/gu,
  /(?<!\d)\+?\d[\d \t\u00a0().-]*\d(?!\d)/gu,
] as const;

type ContactScreening = {
  readonly ruleSetVersion: 'contact-v1';
} & (
  | { readonly status: 'held'; readonly releasedText: null }
  | { readonly status: 'clear'; readonly releasedText: BallotWrittenRecord }
);

/** Screens every releasable written field without changing the immutable Ballot. */
export function screenBallotContacts(
  original: BallotWrittenRecord,
  policy: 'hold' | 'off',
): ContactScreening {
  const removed: string[] = [];
  const redact = (text: string) =>
    contactPatterns.reduce(
      (copy, pattern, index) =>
        copy.replace(pattern, (match) => {
          if (index === 3 && match.replace(/\D/g, '').length < 7) return match;
          removed.push(match);
          return '[contact removed]';
        }),
      text,
    );
  const releasedText: BallotWrittenRecord = {
    ...(original.reason === undefined
      ? {}
      : { reason: redact(original.reason) }),
    ...(original.feedback === undefined
      ? {}
      : {
          feedback: Object.fromEntries(
            Object.entries(original.feedback).map(([key, text]) => [
              key,
              redact(text),
            ]),
          ),
        }),
  };
  return removed.length > 0 && policy === 'hold'
    ? { ruleSetVersion: 'contact-v1', status: 'held', releasedText: null }
    : { ruleSetVersion: 'contact-v1', status: 'clear', releasedText };
}
