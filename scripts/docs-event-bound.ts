/**
 * Keeps the documentation event inside the consult question to a stated
 * size (ISSUE-786). A slice-sized PR carries a long body and hundreds of
 * changed files, and the Documentation Agent refused the whole consult with
 * "Prompt exceeds max length". The event is shortened least-useful-first and
 * every cut is named, so the agent knows what it did not see instead of the
 * run failing.
 */
import type { DocumentationEvent } from './docs-pipeline';

/** The most characters the serialized event may take in a consult question. */
export const EVENT_MAX_CHARS = 6_000;

const CUT = '… [cut]';
const size = (event: DocumentationEvent) => JSON.stringify(event).length;

/** The longest length in 0..max that `fits` accepts, by binary search. */
function longest(max: number, fits: (length: number) => boolean): number {
  let low = 0;
  let high = max;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

const clip = (text: string, length: number) =>
  length >= text.length ? text : text.slice(0, length) + CUT;

type Cut = (event: DocumentationEvent, length: number) => DocumentationEvent;

const withBody =
  (original: string): Cut =>
  (event, length) =>
    event.pullRequest
      ? {
          ...event,
          pullRequest: { ...event.pullRequest, body: clip(original, length) },
        }
      : event;

const withTitle =
  (original: string): Cut =>
  (event, length) =>
    event.pullRequest
      ? {
          ...event,
          pullRequest: { ...event.pullRequest, title: clip(original, length) },
        }
      : event;

const withList =
  (
    key: 'changedFiles' | 'sourceRefs' | 'taskIds',
    original: readonly string[],
  ): Cut =>
  (event, length) => ({ ...event, [key]: original.slice(0, length) });

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** The event shortened to `limit` characters, and what was left out. */
export function boundEvent(
  event: DocumentationEvent,
  limit = EVENT_MAX_CHARS,
): { readonly event: DocumentationEvent; readonly omitted: readonly string[] } {
  if (size(event) <= limit) return { event, omitted: [] };
  const body = event.pullRequest?.body ?? '';
  const title = event.pullRequest?.title ?? '';
  // dispatch defaults sourceRefs to the changed files: the copy goes first.
  const duplicateRefs =
    event.sourceRefs.length > 0 &&
    sameList(event.sourceRefs, event.changedFiles);
  let current: DocumentationEvent = duplicateRefs
    ? { ...event, sourceRefs: [] }
    : event;
  // Shrink one field to the longest prefix that fits.
  const shrink = (cut: Cut, max: number) => {
    if (size(current) <= limit || max === 0) return;
    current = cut(
      current,
      longest(max, (n) => size(cut(current, n)) <= limit),
    );
  };
  // The body is the most useful text: cap it at half the budget first, so the
  // file list keeps some room, and cut it further only when nothing else can go.
  if (size(current) > limit && body.length > limit / 2)
    current = withBody(body)(current, limit / 2);
  shrink(
    withList('changedFiles', event.changedFiles),
    event.changedFiles.length,
  );
  if (!duplicateRefs)
    shrink(withList('sourceRefs', event.sourceRefs), event.sourceRefs.length);
  if (body) shrink(withBody(body), Math.min(body.length, limit / 2));
  shrink(withTitle(title), title.length);
  shrink(withList('taskIds', event.taskIds), event.taskIds.length);
  if (size(current) > limit)
    throw new Error(
      `The documentation event is ${size(current)} characters after every cut; it cannot fit ${limit}`,
    );
  return { event: current, omitted: notes(event, current, duplicateRefs) };
}

function notes(
  before: DocumentationEvent,
  after: DocumentationEvent,
  duplicateRefs: boolean,
): readonly string[] {
  const text = (label: string, from = '', to = '') =>
    to === from
      ? []
      : [
          `${from.length - (to.endsWith(CUT) ? to.length - CUT.length : to.length)} of ${from.length} characters of ${label}`,
        ];
  const list = (
    label: string,
    from: readonly string[],
    to: readonly string[],
  ) =>
    to.length === from.length
      ? []
      : [`${from.length - to.length} of ${from.length} ${label}`];
  return [
    ...(duplicateRefs
      ? [
          `the source refs (the same ${before.sourceRefs.length} paths as the changed files)`,
        ]
      : list('source refs', before.sourceRefs, after.sourceRefs)),
    ...text(
      'the PR body',
      before.pullRequest?.body ?? '',
      after.pullRequest?.body ?? '',
    ),
    ...list('changed files', before.changedFiles, after.changedFiles),
    ...text(
      'the PR title',
      before.pullRequest?.title,
      after.pullRequest?.title,
    ),
    ...list('task ids', before.taskIds, after.taskIds),
  ];
}
