/**
 * Keeps the documentation event inside the consult question to a stated
 * size (ISSUE-786). A slice-sized PR carries a long body and hundreds of
 * changed files, and the Documentation Agent refused the whole consult with
 * "Prompt exceeds max length". The event is shortened in a fixed order (the
 * PR body, then the changed files, then the source refs) and every cut is
 * named, so the agent knows what it did not see instead of the run failing.
 */
import type { DocumentationEvent } from './docs-pipeline';

/** The most characters the serialized event may take in a consult question. */
export const EVENT_MAX_CHARS = 6_000;

const CUT = '… [cut]';
const size = (event: DocumentationEvent) => JSON.stringify(event).length;

/** The longest prefix length `fits` accepts, by binary search over 0..max. */
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

function cutBody(event: DocumentationEvent, limit: number) {
  const body = event.pullRequest?.body;
  if (!event.pullRequest || !body) return undefined;
  const pullRequest = event.pullRequest;
  const withBody = (length: number): DocumentationEvent => ({
    ...event,
    pullRequest: { ...pullRequest, body: body.slice(0, length) + CUT },
  });
  const kept = longest(
    body.length,
    (length) => size(withBody(length)) <= limit,
  );
  return {
    event: withBody(kept),
    note: `the PR body (${kept} of ${body.length} characters kept)`,
  };
}

function cutList(
  event: DocumentationEvent,
  key: 'changedFiles' | 'sourceRefs',
  label: string,
  limit: number,
) {
  const list = event[key];
  const withList = (count: number): DocumentationEvent => ({
    ...event,
    [key]: list.slice(0, count),
  });
  const kept = longest(list.length, (count) => size(withList(count)) <= limit);
  return {
    event: withList(kept),
    note: `${list.length - kept} of ${list.length} ${label}`,
  };
}

/** The event shortened to `limit` characters, and what was left out. */
export function boundEvent(
  event: DocumentationEvent,
  limit = EVENT_MAX_CHARS,
): { readonly event: DocumentationEvent; readonly omitted: readonly string[] } {
  let current = event;
  const omitted: string[] = [];
  const steps = [
    (from: DocumentationEvent) => cutBody(from, limit),
    (from: DocumentationEvent) =>
      cutList(from, 'changedFiles', 'changed files', limit),
    (from: DocumentationEvent) =>
      cutList(from, 'sourceRefs', 'source refs', limit),
  ];
  for (const step of steps) {
    if (size(current) <= limit) break;
    const cut = step(current);
    if (!cut) continue;
    current = cut.event;
    omitted.push(cut.note);
  }
  return { event: current, omitted };
}
