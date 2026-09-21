#!/usr/bin/env bun
import type { DocumentPipeline } from './docs-pipeline';

export const DAISY_DEBATE_DRIVE_ID = 'lguvh1y1ejhadk96xcftohha';
export const DOCUMENTATION_FOLDER_ID = 'lt50h2qea588dpkmmcqgt5ct';
export const DOCUMENTATION_AGENT_ID = 'pvrgxyzjmnhzb303pihcaf7z';
export const DOCUMENTATION_RUNS_SHEET_ID = 'rd0tpc391uf0k2tgpqz451k4';

// Merge dispatch only ever routes to these three (selectPipelines in
// docs-pipeline.ts); the review pipelines audit whatever page they target.
export const DOCUMENTATION_TARGET_PAGES: Readonly<
  Partial<Record<DocumentPipeline, string>>
> = {
  'technical-docs': 'aug9vkhilwxbh93ee9ijr6ry',
  'user-docs': 'p255gony16l747hniqzhyt8h',
  blog: 't6zgifmglzk8ouri4yomqr6k',
};

export function documentationLocation(): {
  readonly driveId: string;
  readonly rootPageId: string;
  readonly agentPageId: string;
} {
  return {
    driveId:
      process.env.PAGESPACE_DOCUMENTATION_DRIVE_ID ?? DAISY_DEBATE_DRIVE_ID,
    rootPageId:
      process.env.PAGESPACE_DOCUMENTATION_ROOT_PAGE_ID ??
      DOCUMENTATION_FOLDER_ID,
    agentPageId:
      process.env.PAGESPACE_DOCUMENTATION_AGENT_PAGE_ID ??
      DOCUMENTATION_AGENT_ID,
  };
}

if (import.meta.main) {
  process.stdout.write(`${JSON.stringify(documentationLocation(), null, 2)}\n`);
}
