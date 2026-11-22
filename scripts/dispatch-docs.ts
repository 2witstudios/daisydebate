#!/usr/bin/env bun
import {
  createDocumentationEvent,
  DOCUMENT_EVENT_TYPES,
  parseChangedFiles,
  type DocumentEventType,
} from './docs-pipeline';
import { assessEventText } from './docs-contracts';
import { DOCUMENTATION_PROMPT_VERSION } from './docs-prompts';
import { describeOutcomes, dispatchDocumentationEvent } from './docs-consult';
import { extractTaskIds } from './notify-drive';
import { mergeChangedFiles } from './docs-merge-files';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const eventType = (): DocumentEventType => {
  const value = process.env.DOC_EVENT_TYPE ?? 'pull_request.merged';
  if (!DOCUMENT_EVENT_TYPES.includes(value as DocumentEventType))
    throw new Error(
      `DOC_EVENT_TYPE must be one of ${DOCUMENT_EVENT_TYPES.join(', ')}`,
    );
  return value as DocumentEventType;
};

export function createDispatchEvent(cwd?: string) {
  const type = eventType();
  const commit = required('DOC_COMMIT');
  const assessed = assessEventText({
    title: required('DOC_TITLE'),
    body: process.env.DOC_BODY ?? null,
    branch: process.env.DOC_BRANCH ?? null,
  });

  return createDocumentationEvent({
    eventId: required('DOC_EVENT_ID'),
    eventType: type,
    occurredAt: required('DOC_OCCURRED_AT'),
    repository: required('DOC_REPOSITORY'),
    baseRef: required('DOC_BASE_REF'),
    commit,
    pullRequest: {
      number: Number(required('DOC_PR_NUMBER')),
      title: assessed.title,
      body: assessed.body === '' ? null : assessed.body,
      url: required('DOC_PR_URL'),
      author: process.env.DOC_AUTHOR ?? null,
      mergedBy: process.env.DOC_MERGED_BY ?? null,
    },
    taskIds: extractTaskIds(
      [assessed.title, assessed.branch, assessed.body]
        .filter(Boolean)
        .join(' '),
    ),
    // Keep merged paths inside this process: exporting a large list can prevent
    // Bun from launching at all (the OS limit applies to each environment value).
    changedFiles:
      type === 'pull_request.merged'
        ? mergeChangedFiles(commit, cwd)
        : parseChangedFiles(required('DOC_CHANGED_FILES')),
    promptVersion: DOCUMENTATION_PROMPT_VERSION,
    textRisk: assessed.textRisk,
    textRiskReasons: assessed.reasons,
  });
}

if (import.meta.main) {
  const event = createDispatchEvent();
  if (event.classification.pipelines.length === 0) {
    process.stdout.write(
      `Documentation no-op: ${event.classification.reasons.join('; ')}\n`,
    );
  } else {
    const outcomes = await dispatchDocumentationEvent(event);
    process.stdout.write(
      `Documentation Agent consulted (text risk: ${event.textRisk}): ${describeOutcomes(outcomes)}\n`,
    );
  }
}
