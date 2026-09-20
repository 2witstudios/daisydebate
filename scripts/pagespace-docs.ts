#!/usr/bin/env bun

export const DAISY_DEBATE_DRIVE_ID = 'lguvh1y1ejhadk96xcftohha';
export const DOCUMENTATION_FOLDER_ID = 'lt50h2qea588dpkmmcqgt5ct';
export const DOCUMENTATION_AGENT_ID = 'pvrgxyzjmnhzb303pihcaf7z';

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
