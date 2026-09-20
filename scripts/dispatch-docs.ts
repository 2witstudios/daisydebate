#!/usr/bin/env bun
import { createDocumentationEvent, parseChangedFiles } from './docs-pipeline';
import { extractTaskIds, postDocumentationEvent } from './notify-drive';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const event = createDocumentationEvent({
  eventId: required('DOC_EVENT_ID'),
  eventType: 'pull_request.merged',
  occurredAt: required('DOC_OCCURRED_AT'),
  repository: required('DOC_REPOSITORY'),
  baseRef: required('DOC_BASE_REF'),
  commit: required('DOC_COMMIT'),
  pullRequest: {
    number: Number(required('DOC_PR_NUMBER')),
    title: required('DOC_TITLE'),
    body: process.env.DOC_BODY ?? null,
    url: required('DOC_PR_URL'),
    author: process.env.DOC_AUTHOR ?? null,
    mergedBy: process.env.DOC_MERGED_BY ?? null,
  },
  taskIds: extractTaskIds(
    [process.env.DOC_TITLE, process.env.DOC_BRANCH, process.env.DOC_BODY]
      .filter(Boolean)
      .join(' '),
  ),
  changedFiles: parseChangedFiles(required('DOC_CHANGED_FILES')),
});

if (event.classification.pipelines.length === 0) {
  process.stdout.write(
    `Documentation no-op: ${event.classification.reasons.join('; ')}\n`,
  );
} else {
  await postDocumentationEvent(event);
  process.stdout.write(
    `Documentation event dispatched to ${event.classification.pipelines.join(', ')}\n`,
  );
}
